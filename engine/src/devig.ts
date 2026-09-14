/**
 * Removing the bookmaker's margin.
 *
 * A quoted 1X2 market whose implied probabilities sum to 1.08 carries an 8%
 * overround. To compare our number against the book's actual opinion, that
 * margin has to come out — and *how* it comes out matters more than it looks.
 *
 * The obvious method divides every implied probability by the sum. That assumes
 * the margin is spread proportionally, which it demonstrably is not: books load
 * more margin onto longshots (the favourite-longshot bias). Use proportional
 * de-vigging and you will systematically believe longshots are better priced
 * than they are, and the model will drift toward backing them — precisely the
 * failure mode that makes a tipping product look clever and lose money.
 *
 * Shin's method instead models the margin as arising from a proportion `z` of
 * insider money, and recovers probabilities that bend the right way. It is the
 * standard correction and it is twenty lines.
 *
 * Both are computed; Shin is used unless it fails to converge, and which one
 * produced a number is recorded rather than hidden.
 */

export interface DevigResult {
  probs: number[];
  overround: number;
  method: 'shin' | 'multiplicative';
  /** Shin's estimated insider proportion. Typically 0.01–0.05. */
  z: number;
}

export function multiplicative(odds: number[]): DevigResult {
  const raw = odds.map((o) => 1 / o);
  const sum = raw.reduce((a, b) => a + b, 0);
  return {
    probs: raw.map((p) => p / sum),
    overround: sum,
    method: 'multiplicative',
    z: 0,
  };
}

/**
 * Shin (1992/1993). Solves for the insider proportion z that makes the implied
 * probabilities sum to one:
 *
 *   p_i = [ sqrt(z² + 4(1−z)·π_i²/Π) − z ] / (2(1−z))
 *
 * where π_i = 1/odds_i and Π is their sum. Monotonic in z, so bisection is both
 * sufficient and completely reliable — no starting-point sensitivity.
 */
export function shin(odds: number[]): DevigResult {
  if (odds.length < 2 || odds.some((o) => !Number.isFinite(o) || o <= 1)) {
    return multiplicative(odds.map((o) => (Number.isFinite(o) && o > 1 ? o : 1e9)));
  }

  const pi = odds.map((o) => 1 / o);
  const total = pi.reduce((a, b) => a + b, 0);

  // No margin (or a negative one — an arbitrage across books). Nothing to strip.
  if (total <= 1.0000001) {
    return { probs: pi.slice(), overround: total, method: 'shin', z: 0 };
  }

  const sumAt = (z: number): number => {
    if (z >= 0.999) return Number.NaN;
    let s = 0;
    for (const p of pi) {
      const inner = z * z + (4 * (1 - z) * p * p) / total;
      s += (Math.sqrt(Math.max(0, inner)) - z) / (2 * (1 - z));
    }
    return s;
  };

  // At z = 0 the formula reduces to proportional de-vigging, so the sum is 1
  // only when there is no margin; it decreases as z rises. Bracket and bisect.
  let lo = 0;
  let hi = 0.5;
  if (!Number.isFinite(sumAt(hi)) || sumAt(hi) > 1) {
    return multiplicative(odds);
  }

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const s = sumAt(mid);
    if (!Number.isFinite(s)) {
      hi = mid;
      continue;
    }
    if (s > 1) lo = mid;
    else hi = mid;
  }

  const z = (lo + hi) / 2;
  const probs = pi.map((p) => {
    const inner = z * z + (4 * (1 - z) * p * p) / total;
    return (Math.sqrt(Math.max(0, inner)) - z) / (2 * (1 - z));
  });

  const check = probs.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(check) || Math.abs(check - 1) > 1e-4 || probs.some((p) => p <= 0 || p >= 1)) {
    return multiplicative(odds);
  }

  // Renormalise away the last of the bisection residual.
  return {
    probs: probs.map((p) => p / check),
    overround: total,
    method: 'shin',
    z,
  };
}

export function devig(odds: number[]): DevigResult {
  return shin(odds);
}

/**
 * Fair decimal odds for a probability, i.e. the price at which a bet breaks
 * even. Useful for showing "we make it 2.40, they are offering 2.75".
 */
export function fairOdds(p: number): number {
  return p > 0 ? 1 / p : Infinity;
}

/**
 * Kelly stake as a fraction of bankroll, for decimal odds `d` and true
 * probability `p`. Returns 0 when there is no edge — Kelly is only defined on
 * a positive expectation and a negative "stake" is not a bet.
 */
export function kelly(p: number, d: number, fraction = 1): number {
  const b = d - 1;
  if (b <= 0) return 0;
  const f = (p * b - (1 - p)) / b;
  return f > 0 ? f * fraction : 0;
}

/** Expected value per unit staked. */
export function expectedValue(p: number, d: number): number {
  return p * (d - 1) - (1 - p);
}
