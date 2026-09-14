import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDixonColes, defaultFitOptions, expectedGoals, tau } from '../src/ratings/dixoncoles.ts';
import type { MatchRow } from '../src/types.ts';

/** Deterministic PRNG so a failure is always reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda: number, rnd: () => number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > L);
  return k - 1;
}

/**
 * Generate a full double round-robin season from known attack/defence values,
 * then check the fitter recovers them. This is the test that matters: if the
 * optimiser cannot find parameters it generated the data from, nothing built on
 * top of it means anything.
 */
function syntheticSeason(
  nTeams: number,
  seasons: number,
  trueAtt: number[],
  trueDef: number[],
  mu0: number,
  gamma: number,
  seed: number,
): MatchRow[] {
  const rnd = mulberry32(seed);
  const rows: MatchRow[] = [];
  let id = 1;
  const now = Math.floor(Date.now() / 1000);
  let day = 0;

  for (let s = 0; s < seasons; s++) {
    for (let i = 0; i < nTeams; i++) {
      for (let j = 0; j < nTeams; j++) {
        if (i === j) continue;
        const lh = Math.exp(mu0 + gamma + trueAtt[i]! - trueDef[j]!);
        const la = Math.exp(mu0 + trueAtt[j]! - trueDef[i]!);
        day += 1;
        rows.push({
          id: id++,
          league_id: 1,
          season_id: s,
          // Spread matches back in time, newest last.
          kickoff: now - (nTeams * nTeams * seasons - day) * 3600 * 8,
          home_team_id: i + 1,
          away_team_id: j + 1,
          home_goals: poisson(lh, rnd),
          away_goals: poisson(la, rnd),
          home_xg: null,
          away_xg: null,
          xg_estimated: null,
          home_corners: null,
          away_corners: null,
          home_yellows: null,
          away_yellows: null,
          home_reds: null,
          away_reds: null,
          referee_id: null,
        });
      }
    }
  }
  return rows;
}

test('tau only touches the four low scorelines', () => {
  const rho = -0.12;
  for (let x = 0; x <= 5; x++) {
    for (let y = 0; y <= 5; y++) {
      const t = tau(x, y, 1.4, 1.1, rho);
      if (x <= 1 && y <= 1) {
        assert.notEqual(t, 1, `tau should adjust ${x}-${y}`);
      } else {
        assert.equal(t, 1, `tau must leave ${x}-${y} alone`);
      }
    }
  }
});

test('tau pushes probability toward 0-0 and 1-1 when rho is negative', () => {
  const rho = -0.12;
  // Negative rho is the empirically observed direction in real football: more
  // score draws than independent Poisson predicts, fewer 1-0 and 0-1.
  assert.ok(tau(0, 0, 1.4, 1.1, rho) > 1, '0-0 should be lifted');
  assert.ok(tau(1, 1, 1.4, 1.1, rho) > 1, '1-1 should be lifted');
  assert.ok(tau(1, 0, 1.4, 1.1, rho) < 1, '1-0 should be reduced');
  assert.ok(tau(0, 1, 1.4, 1.1, rho) < 1, '0-1 should be reduced');
});

test('fitter recovers known attack and defence from synthetic seasons', () => {
  const nTeams = 20;
  // A realistic spread: roughly ±35% on the log scale between best and worst.
  const trueAtt = Array.from({ length: nTeams }, (_, i) => (i - (nTeams - 1) / 2) * 0.045);
  const trueDef = Array.from({ length: nTeams }, (_, i) => (i - (nTeams - 1) / 2) * 0.038);
  const mu0 = Math.log(1.35);
  const gamma = 0.26;

  const rows = syntheticSeason(nTeams, 3, trueAtt, trueDef, mu0, gamma, 42);

  const opts = defaultFitOptions(Math.floor(Date.now() / 1000));
  // No decay and light shrinkage: this test is about the optimiser finding the
  // truth, not about how we handle recency or thin samples.
  opts.xi = 0;
  opts.priorMatches = 1;
  opts.fitRho = false;
  opts.rho = 0;
  opts.maxIter = 2500;

  const fit = fitDixonColes(rows, 1, opts);
  assert.equal(fit.teams.size, nTeams);

  // Ratings are identified only up to the sum-to-zero constraint, which the
  // generating values already satisfy, so they are directly comparable.
  let attErr = 0;
  let defErr = 0;
  for (let i = 0; i < nTeams; i++) {
    const r = fit.teams.get(i + 1)!;
    attErr += Math.abs(r.attack - trueAtt[i]!);
    defErr += Math.abs(r.defence - trueDef[i]!);
  }
  attErr /= nTeams;
  defErr /= nTeams;

  assert.ok(attErr < 0.06, `mean attack error ${attErr.toFixed(4)} should be small`);
  assert.ok(defErr < 0.06, `mean defence error ${defErr.toFixed(4)} should be small`);
  assert.ok(
    Math.abs(fit.params.home_adv - gamma) < 0.06,
    `home advantage ${fit.params.home_adv.toFixed(3)} vs true ${gamma}`,
  );
  assert.ok(
    Math.abs(fit.params.mean_goals - Math.exp(mu0)) < 0.12,
    `mean goals ${fit.params.mean_goals.toFixed(3)} vs true ${Math.exp(mu0).toFixed(3)}`,
  );

  // The ordering matters more than the absolute values for betting purposes.
  const ranked = [...fit.teams.values()].sort((a, b) => b.attack - a.attack);
  assert.equal(ranked[0]!.team_id, nTeams, 'strongest attack should rank first');
  assert.equal(ranked[ranked.length - 1]!.team_id, 1, 'weakest attack should rank last');
});

/** Sample a scoreline from the Dixon-Coles joint distribution. */
function sampleDC(lh: number, la: number, rho: number, rnd: () => number): [number, number] {
  const MAX = 10;
  const ph: number[] = [];
  const pa: number[] = [];
  let fh = 1;
  let fa = 1;
  for (let k = 0; k <= MAX; k++) {
    if (k > 0) { fh *= k; fa *= k; }
    ph.push((Math.exp(-lh) * Math.pow(lh, k)) / fh);
    pa.push((Math.exp(-la) * Math.pow(la, k)) / fa);
  }
  const cells: Array<{ x: number; y: number; p: number }> = [];
  let total = 0;
  for (let x = 0; x <= MAX; x++) {
    for (let y = 0; y <= MAX; y++) {
      const pr = ph[x]! * pa[y]! * tau(x, y, lh, la, rho);
      const safe = Math.max(0, pr);
      cells.push({ x, y, p: safe });
      total += safe;
    }
  }
  let u = rnd() * total;
  for (const c of cells) {
    u -= c.p;
    if (u <= 0) return [c.x, c.y];
  }
  return [0, 0];
}

function seasonWithRho(nTeams: number, seasons: number, rho: number, seed: number): MatchRow[] {
  const rnd = mulberry32(seed);
  const att = Array.from({ length: nTeams }, (_, i) => (i - (nTeams - 1) / 2) * 0.04);
  const def = Array.from({ length: nTeams }, (_, i) => (i - (nTeams - 1) / 2) * 0.03);
  const mu0 = Math.log(1.35);
  const gamma = 0.25;
  const rows: MatchRow[] = [];
  let id = 1;
  const now = Math.floor(Date.now() / 1000);
  let day = 0;
  for (let s = 0; s < seasons; s++) {
    for (let i = 0; i < nTeams; i++) {
      for (let j = 0; j < nTeams; j++) {
        if (i === j) continue;
        const lh = Math.exp(mu0 + gamma + att[i]! - def[j]!);
        const la = Math.exp(mu0 + att[j]! - def[i]!);
        const [x, y] = sampleDC(lh, la, rho, rnd);
        day += 1;
        rows.push({
          id: id++, league_id: 1, season_id: s,
          kickoff: now - (nTeams * nTeams * seasons - day) * 3600 * 8,
          home_team_id: i + 1, away_team_id: j + 1,
          home_goals: x, away_goals: y,
          home_xg: null, away_xg: null, xg_estimated: null,
          home_corners: null, away_corners: null, home_yellows: null,
          away_yellows: null, home_reds: null, away_reds: null, referee_id: null,
        });
      }
    }
  }
  return rows;
}

test('fitter recovers a genuine rho given enough low-score matches', () => {
  const trueRho = -0.13;
  // 20 teams x 380 x 8 seasons: enough low-score matches to overwhelm the prior
  // and identify rho on its own merits.
  const rows = seasonWithRho(20, 8, trueRho, 11);
  const opts = defaultFitOptions(Math.floor(Date.now() / 1000));
  opts.xi = 0;
  opts.priorMatches = 1;
  opts.fitRho = true;
  opts.maxIter = 2500;

  const fit = fitDixonColes(rows, 1, opts);
  assert.ok(fit.rhoInformative > 700, `expected plenty of low-score matches, got ${fit.rhoInformative}`);
  assert.ok(
    Math.abs(fit.params.rho - trueRho) < 0.05,
    `rho ${fit.params.rho.toFixed(4)} should be near ${trueRho}`,
  );
});

test('the rho prior stops a thin sample inventing a positive dependence', () => {
  // Independent Poisson, one league's worth of history. The unregularised MLE
  // on this exact sample is about +0.09 — pure noise, and the wrong sign, which
  // would push probability away from score draws. The prior must absorb it.
  const rows = seasonWithRho(16, 3, 0, 7);
  const opts = defaultFitOptions(Math.floor(Date.now() / 1000));
  opts.xi = 0;
  opts.priorMatches = 1;
  opts.fitRho = true;
  opts.maxIter = 2500;

  const fit = fitDixonColes(rows, 1, opts);
  assert.ok(
    fit.params.rho < 0.01,
    `rho ${fit.params.rho.toFixed(4)} must not go positive on noise`,
  );
  // It should land between the prior and the noisy MLE, not sit exactly on
  // either: the data is allowed to speak, just not to shout.
  assert.ok(
    fit.params.rho > opts.rhoPrior,
    `rho ${fit.params.rho.toFixed(4)} should be pulled off the prior by the data`,
  );
});

test('shrinkage pulls thin-sample teams toward the league mean', () => {
  const now = Math.floor(Date.now() / 1000);
  const rows: MatchRow[] = [];
  let id = 1;
  // Team 99 plays twice and wins big both times; established teams play often.
  for (let i = 0; i < 60; i++) {
    rows.push({
      id: id++, league_id: 1, season_id: 1, kickoff: now - i * 86400,
      home_team_id: (i % 6) + 1, away_team_id: ((i + 3) % 6) + 1,
      home_goals: 1, away_goals: 1,
      home_xg: null, away_xg: null, xg_estimated: null,
      home_corners: null, away_corners: null, home_yellows: null,
      away_yellows: null, home_reds: null, away_reds: null, referee_id: null,
    });
  }
  for (let i = 0; i < 2; i++) {
    rows.push({
      id: id++, league_id: 1, season_id: 1, kickoff: now - i * 86400,
      home_team_id: 99, away_team_id: (i % 6) + 1,
      home_goals: 5, away_goals: 0,
      home_xg: null, away_xg: null, xg_estimated: null,
      home_corners: null, away_corners: null, home_yellows: null,
      away_yellows: null, home_reds: null, away_reds: null, referee_id: null,
    });
  }

  const opts = defaultFitOptions(now);
  opts.xi = 0;
  opts.fitRho = false;
  opts.rho = 0;
  const fit = fitDixonColes(rows, 1, opts);

  const thin = fit.teams.get(99)!;
  const established = fit.teams.get(1)!;
  assert.ok(thin.shrunk > 0.5, 'a two-match team should be heavily shrunk');
  assert.ok(established.shrunk < 0.5, 'a twenty-match team should be lightly shrunk');
  assert.ok(
    thin.attack_se > established.attack_se,
    'the thin team must carry more uncertainty, not just a smaller number',
  );
  // Two 5-0 wins imply exp(att) far above average; shrinkage must not let the
  // rating run away to that.
  assert.ok(thin.attack < 1.0, `thin-sample attack ${thin.attack.toFixed(3)} should stay bounded`);
});

test('expectedGoals treats an unseen team as average rather than hopeless', () => {
  const now = Math.floor(Date.now() / 1000);
  const rows = syntheticSeason(8, 2, new Array(8).fill(0), new Array(8).fill(0), Math.log(1.4), 0.25, 3);
  const opts = defaultFitOptions(now);
  opts.xi = 0;
  opts.fitRho = false;
  opts.rho = 0;
  const fit = fitDixonColes(rows, 1, opts);

  const known = expectedGoals(fit, 1, 2);
  const unknown = expectedGoals(fit, 1, 999999);
  assert.ok(known.known.home && known.known.away);
  assert.equal(unknown.known.away, false);
  assert.ok(unknown.away > 0.5 && unknown.away < 3, 'unknown side gets a league-average rate');
});
