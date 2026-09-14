import { config } from '../config.ts';
import type { LeagueParams, MatchRow, RatingSet, TeamRating } from '../types.ts';

/**
 * Dixon-Coles (1997) with time decay, ridge shrinkage and approximate standard
 * errors, fitted by maximum likelihood.
 *
 * Parameterisation:
 *
 *   λ_home = exp(μ0 + γ + att_home − def_away)
 *   λ_away = exp(μ0     + att_away − def_home)
 *
 * with Σatt = Σdef = 0, so μ0 is the league's log scoring level, γ is home
 * advantage, and a team's att/def read as "goals above or below league average"
 * on the log scale. The sum-to-zero constraints are what make those numbers
 * comparable between teams at all.
 *
 * Three departures from a textbook implementation, each for a reason the
 * doctrine cares about:
 *
 * - **Ridge shrinkage toward the league mean**, strength set in effective
 *   matches. §13 objects to thin data being used as thick; a promoted side
 *   three games into a season is exactly that, and without shrinkage three
 *   August wins make them look like contenders.
 * - **Standard errors carried forward**, so §7.3's "burden of proof is on us"
 *   has something concrete behind it: how far we're allowed to disagree with
 *   the market depends on how well we actually know the team.
 * - **Quasi-likelihood on xG**, so the same fitter handles the continuous case
 *   and the goals/xG blend is a blend of two real fits rather than a fudge.
 */

export interface FitOptions {
  /** Reference date for time decay; matches are weighted by age relative to it. */
  asOf: number;
  /** Decay per day. */
  xi: number;
  /** Fit ρ as a free parameter, or hold it. */
  fitRho: boolean;
  rho: number;
  /** Where a fitted ρ is pulled back to when the data is thin. */
  rhoPrior: number;
  /** Prior strength for ρ, in low-score matches. */
  rhoPriorMatches: number;
  /** Use xG in place of goals. Disables the low-score correction, which is a
   *  statement about discrete scorelines and means nothing for a continuous rate. */
  useXg: boolean;
  maxIter: number;
  tolerance: number;
  priorMatches: number;
}

export function defaultFitOptions(asOf: number): FitOptions {
  return {
    asOf,
    xi: config.ratings.xi,
    fitRho: true,
    rho: config.ratings.rho,
    rhoPrior: config.ratings.rho,
    rhoPriorMatches: config.ratings.rhoPriorMatches,
    useXg: false,
    maxIter: config.ratings.maxIter,
    tolerance: config.ratings.tolerance,
    priorMatches: config.ratings.priorMatches,
  };
}

/**
 * Dixon-Coles low-score dependence. Real football produces more 0-0 and 1-1
 * than independent Poisson expects, and fewer 1-0 and 0-1; τ moves probability
 * between exactly those four cells and leaves every other scoreline alone.
 */
export function tau(x: number, y: number, lh: number, la: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

interface Obs {
  hi: number; // home index
  ai: number; // away index
  x: number;  // home goals (or xG)
  y: number;  // away goals (or xG)
  w: number;  // time-decay weight
  discrete: boolean;
}

export interface FitResult extends RatingSet {
  converged: boolean;
  iterations: number;
  /** Decay-weighted count of low-score matches — all that informs ρ. */
  rhoInformative: number;
}

export function fitDixonColes(matches: MatchRow[], leagueId: number, opts: FitOptions): FitResult {
  // ---- assemble observations -------------------------------------------
  const teamIndex = new Map<number, number>();
  const teamIds: number[] = [];
  const idx = (id: number): number => {
    let i = teamIndex.get(id);
    if (i === undefined) {
      i = teamIds.length;
      teamIndex.set(id, i);
      teamIds.push(id);
    }
    return i;
  };

  const obs: Obs[] = [];
  for (const m of matches) {
    const x = opts.useXg ? m.home_xg : m.home_goals;
    const y = opts.useXg ? m.away_xg : m.away_goals;
    if (x === null || x === undefined || y === null || y === undefined) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) continue;

    const ageDays = Math.max(0, (opts.asOf - m.kickoff) / 86400);
    const w = Math.exp(-opts.xi * ageDays);
    if (w < 1e-4) continue; // contributes nothing; skip the arithmetic

    obs.push({
      hi: idx(m.home_team_id),
      ai: idx(m.away_team_id),
      x,
      y,
      w,
      discrete: !opts.useXg,
    });
  }

  const n = teamIds.length;
  if (n < 2 || obs.length < n) {
    return {
      params: emptyParams(leagueId, opts),
      teams: new Map(),
      converged: false,
      iterations: 0,
      rhoInformative: 0,
    };
  }

  // Effective (decay-weighted) match count per team — the basis for both
  // shrinkage and the reported sample size.
  const wMatches = new Float64Array(n);
  let totalW = 0;
  let totalGoals = 0;
  for (const o of obs) {
    wMatches[o.hi]! += o.w;
    wMatches[o.ai]! += o.w;
    totalW += o.w;
    totalGoals += o.w * (o.x + o.y);
  }
  const meanGoalsPerTeam = totalGoals / (2 * totalW);

  // ---- parameters -------------------------------------------------------
  // Layout: [att_0..att_{n-1}, def_0..def_{n-1}, mu0, gamma, rho]
  const P = 2 * n + 3;
  const MU0 = 2 * n;
  const GAM = 2 * n + 1;
  const RHO = 2 * n + 2;

  const p = new Float64Array(P);
  p[MU0] = Math.log(Math.max(0.2, meanGoalsPerTeam));
  p[GAM] = 0.25; // ~1.28x home multiplier; a sane starting point, not a fixed value
  p[RHO] = opts.rho;

  // Ridge strength in the same units as the Fisher information, so that a team
  // with `priorMatches` weighted matches sits halfway between its own record
  // and the league mean.
  const ridge = opts.priorMatches * Math.max(0.2, meanGoalsPerTeam);

  // Each low-score match contributes roughly unit information about ρ, so the
  // prior's strength is expressed in the same currency: `rhoPriorMatches`
  // low-score matches move the estimate halfway off the prior.
  let informative = 0;
  for (const o of obs) if (o.discrete && o.x <= 1 && o.y <= 1) informative += o.w;
  const rhoPrecision = opts.fitRho ? opts.rhoPriorMatches : 0;

  // ---- objective and gradient -------------------------------------------
  const grad = new Float64Array(P);

  const evaluate = (): number => {
    grad.fill(0);
    let ll = 0;
    const mu0 = p[MU0]!;
    const gam = p[GAM]!;
    const rho = p[RHO]!;

    for (const o of obs) {
      const attH = p[o.hi]!;
      const defH = p[n + o.hi]!;
      const attA = p[o.ai]!;
      const defA = p[n + o.ai]!;

      const lh = Math.exp(mu0 + gam + attH - defA);
      const la = Math.exp(mu0 + attA - defH);

      // Poisson kernel, dropping log(x!) which does not depend on parameters.
      ll += o.w * (-lh + o.x * Math.log(lh) - la + o.y * Math.log(la));

      // d(kernel)/d(log rate)
      let gh = o.x - lh;
      let ga = o.y - la;

      if (o.discrete && rho !== 0 && o.x <= 1 && o.y <= 1) {
        const t = tau(o.x, o.y, lh, la, rho);
        if (t > 1e-10) {
          ll += o.w * Math.log(t);
          // ∂τ/∂λ and ∂τ/∂μ, chained through λ = exp(·) so multiply by the rate.
          let dth = 0;
          let dta = 0;
          let dtr = 0;
          if (o.x === 0 && o.y === 0) {
            dth = -la * rho * lh;
            dta = -lh * rho * la;
            dtr = -lh * la;
          } else if (o.x === 0 && o.y === 1) {
            dth = rho * lh;
            dtr = lh;
          } else if (o.x === 1 && o.y === 0) {
            dta = rho * la;
            dtr = la;
          } else {
            dtr = -1;
          }
          gh += dth / t;
          ga += dta / t;
          grad[RHO]! += (o.w * dtr) / t;
        } else {
          // τ has gone non-positive: ρ has wandered out of the admissible
          // region for these rates. Penalise hard and let the optimiser back off.
          ll -= 1e6 * o.w;
        }
      }

      const wh = o.w * gh;
      const wa = o.w * ga;

      grad[o.hi]! += wh;            // att_home raises λ_home
      grad[n + o.ai]! -= wh;        // def_away lowers λ_home
      grad[o.ai]! += wa;            // att_away raises λ_away
      grad[n + o.hi]! -= wa;        // def_home lowers λ_away
      grad[MU0]! += wh + wa;
      grad[GAM]! += wh;
    }

    // Gaussian prior on att/def, centred on the league mean (zero by constraint).
    for (let i = 0; i < n; i++) {
      const a = p[i]!;
      const d = p[n + i]!;
      ll -= 0.5 * ridge * (a * a + d * d);
      grad[i]! -= ridge * a;
      grad[n + i]! -= ridge * d;
    }

    // Prior on ρ. Only the four low-score cells carry information about it, so
    // a single league-season identifies it poorly: the standard error is
    // roughly 1/√(low-score matches), which on a 380-match season is about
    // 0.07 — the same size as the effect being estimated. Left unregularised
    // the fit will happily adopt a *positive* ρ from noise, which pushes
    // probability away from score draws: worse than not correcting at all.
    //
    // Every published estimate for football is negative, so the prior is
    // negative and the data has to earn its way off it.
    if (opts.fitRho && rhoPrecision > 0) {
      const dr = rho - opts.rhoPrior;
      ll -= 0.5 * rhoPrecision * dr * dr;
      grad[RHO]! -= rhoPrecision * dr;
    }

    if (!opts.fitRho) grad[RHO] = 0;
    return ll;
  };

  // ---- Adam ascent with decay -------------------------------------------
  // The Poisson part is concave in these parameters; the τ term is a small,
  // well-behaved perturbation. Adam handles it without needing a Hessian, and
  // is far less fragile than hand-rolled Newton when ρ approaches its bound.
  //
  // The decay schedule is not optional. Adam's update is scale-free — every
  // parameter moves by roughly ±lr regardless of how large its gradient is —
  // so at a fixed learning rate it never settles, it orbits the optimum at a
  // radius of about lr. On synthetic data generated with ρ = 0 exactly, a fixed
  // lr of 0.05 recovers ρ ≈ 0.09: an invented dependence of the same size the
  // correction is supposed to detect in real leagues. Decaying the step lets
  // the fit actually land, and convergence is judged on the gradient norm
  // rather than on the likelihood creeping, which a scale-free optimiser can
  // do indefinitely while still being wrong.
  const m1 = new Float64Array(P);
  const v1 = new Float64Array(P);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  const lr0 = 0.05;
  const decay = 0.997;
  const lrFloor = 1e-5;

  let converged = false;
  let iter = 0;

  for (iter = 1; iter <= opts.maxIter; iter++) {
    evaluate();

    const lr = Math.max(lrFloor, lr0 * Math.pow(decay, iter));
    let gradNorm = 0;

    for (let k = 0; k < P; k++) {
      const g = grad[k]!;
      gradNorm += g * g;
      m1[k] = beta1 * m1[k]! + (1 - beta1) * g;
      v1[k] = beta2 * v1[k]! + (1 - beta2) * g * g;
      const mHat = m1[k]! / (1 - Math.pow(beta1, iter));
      const vHat = v1[k]! / (1 - Math.pow(beta2, iter));
      p[k] = p[k]! + (lr * mHat) / (Math.sqrt(vHat) + eps);
    }
    gradNorm = Math.sqrt(gradNorm);

    // Re-impose Σatt = Σdef = 0. Without this the fit drifts along the
    // unidentified direction and the ratings stop being comparable.
    let sa = 0;
    let sd = 0;
    for (let i = 0; i < n; i++) {
      sa += p[i]!;
      sd += p[n + i]!;
    }
    sa /= n;
    sd /= n;
    for (let i = 0; i < n; i++) {
      p[i] = p[i]! - sa;
      p[n + i] = p[n + i]! - sd;
    }
    // μ0 absorbs the level that centring just removed, so λ is unchanged.
    p[MU0] = p[MU0]! + sa - sd;

    // ρ must keep τ positive for the rates in play; this band is comfortably
    // inside the admissible region for football-sized λ.
    p[RHO] = Math.max(-0.3, Math.min(0.3, p[RHO]!));

    // Scaled by the data size, so the same tolerance means the same thing in a
    // 380-match league season and a 3,000-match backfill.
    if (iter > 50 && gradNorm / Math.max(1, obs.length) < opts.tolerance) {
      converged = true;
      break;
    }
  }

  const logLik = evaluate();

  // ---- standard errors ---------------------------------------------------
  // Diagonal of the observed information. For a Poisson GLM the curvature in
  // att_i is Σ w·λ over that team's matches, plus the ridge. Off-diagonal terms
  // are ignored, so these are approximate — they are used as a relative measure
  // of how well a team is known, not as a confidence interval.
  const infoAtt = new Float64Array(n);
  const infoDef = new Float64Array(n);
  {
    const mu0 = p[MU0]!;
    const gam = p[GAM]!;
    for (const o of obs) {
      const lh = Math.exp(mu0 + gam + p[o.hi]! - p[n + o.ai]!);
      const la = Math.exp(mu0 + p[o.ai]! - p[n + o.hi]!);
      infoAtt[o.hi]! += o.w * lh;
      infoDef[o.ai]! += o.w * lh;
      infoAtt[o.ai]! += o.w * la;
      infoDef[o.hi]! += o.w * la;
    }
    for (let i = 0; i < n; i++) {
      infoAtt[i]! += ridge;
      infoDef[i]! += ridge;
    }
  }

  const teams = new Map<number, TeamRating>();
  for (let i = 0; i < n; i++) {
    const eff = wMatches[i]!;
    teams.set(teamIds[i]!, {
      team_id: teamIds[i]!,
      attack: p[i]!,
      defence: p[n + i]!,
      attack_se: 1 / Math.sqrt(Math.max(1e-6, infoAtt[i]!)),
      defence_se: 1 / Math.sqrt(Math.max(1e-6, infoDef[i]!)),
      matches: eff,
      shrunk: opts.priorMatches / (opts.priorMatches + eff),
    });
  }

  return {
    params: {
      league_id: leagueId,
      home_adv: p[GAM]!,
      rho: opts.fitRho ? p[RHO]! : opts.rho,
      xi: opts.xi,
      mean_goals: Math.exp(p[MU0]!),
      n_matches: obs.length,
      log_lik: logLik,
    },
    teams,
    converged,
    iterations: iter,
    rhoInformative: informative,
  };
}

function emptyParams(leagueId: number, opts: FitOptions): LeagueParams {
  return {
    league_id: leagueId,
    home_adv: 0.25,
    rho: opts.rho,
    xi: opts.xi,
    mean_goals: 1.35,
    n_matches: 0,
    log_lik: 0,
  };
}

/**
 * Expected goals for a fixture from fitted ratings, before any context
 * adjustment. A team we have never seen falls back to league average rather
 * than to zero — an unknown side is average, not hopeless.
 */
export function expectedGoals(
  set: RatingSet,
  homeTeamId: number,
  awayTeamId: number,
): { home: number; away: number; known: { home: boolean; away: boolean } } {
  const h = set.teams.get(homeTeamId);
  const a = set.teams.get(awayTeamId);
  const mu0 = Math.log(set.params.mean_goals);

  const attH = h?.attack ?? 0;
  const defH = h?.defence ?? 0;
  const attA = a?.attack ?? 0;
  const defA = a?.defence ?? 0;

  return {
    home: Math.exp(mu0 + set.params.home_adv + attH - defA),
    away: Math.exp(mu0 + attA - defH),
    known: { home: !!h, away: !!a },
  };
}
