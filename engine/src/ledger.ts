import { config } from './config.ts';
import type { Adjustment, Channel, Claim, EvidenceState, Factor, Side, Tier } from './types.ts';

/**
 * Construction and combination of evidence.
 *
 * The doctrine's §13 says thin data must be stated as thin and excluded. That
 * is easy to agree with and easy to forget, so it is enforced by construction
 * here: `thin()` and `unavailable()` physically cannot carry adjustments or
 * claims. A factor that didn't clear its sample gate has no route into the
 * model — not a small weight, no route at all.
 */

interface FactorInit {
  id: string;
  section: string;
  tier: Tier;
  note: string;
  evidence?: Record<string, unknown>;
}

export function computed(
  init: FactorInit & {
    adjustments?: Adjustment[];
    claims?: Claim[];
    strength?: number;
  },
): Factor {
  return {
    id: init.id,
    section: init.section,
    tier: init.tier,
    state: 'COMPUTED',
    note: init.note,
    evidence: init.evidence ?? {},
    adjustments: (init.adjustments ?? []).map(capAdjustment),
    claims: init.claims ?? [],
    strength: clamp(init.strength ?? 0.5, 0, 1),
  };
}

/** Data exists but is below its sample gate. Reported, never used. */
export function thin(init: FactorInit): Factor {
  return { ...base(init), state: 'THIN' };
}

/** No data at all, or the endpoint is behind a tier we don't hold. */
export function unavailable(init: FactorInit): Factor {
  return { ...base(init), state: 'UNAVAILABLE' };
}

function base(init: FactorInit): Factor {
  return {
    id: init.id,
    section: init.section,
    tier: init.tier,
    state: 'COMPUTED',
    note: init.note,
    evidence: init.evidence ?? {},
    adjustments: [],
    claims: [],
    strength: 0,
  };
}

/**
 * Decide between COMPUTED and THIN on sample size, so the check cannot be
 * skipped by accident at a call site.
 */
export function gate(
  n: number,
  min: number,
  init: FactorInit & { adjustments?: Adjustment[]; claims?: Claim[]; strength?: number },
): Factor {
  if (n >= min) return computed(init);
  return thin({
    ...init,
    // "sample of 20 is below the 30 needed" is the evidence state talking, and
    // the evidence state is ours. What a reader needs is why this is being
    // mentioned and then set aside, which is that there is not enough of it.
    note: `${init.note} — though ${n} game${n === 1 ? '' : 's'} is too few to read much into, so it is left out of the call.`,
    evidence: { ...(init.evidence ?? {}), sample: n, required: min },
  });
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** No single factor may move a rate by more than the per-factor cap. */
function capAdjustment(a: Adjustment): Adjustment {
  const cap = config.context.factorCap;
  return { ...a, multiplier: clamp(a.multiplier, 1 - cap, 1 + cap) };
}

export function adj(channel: Channel, side: Side, multiplier: number): Adjustment {
  return { channel, side, multiplier };
}

/**
 * Turn a signed strength in [-1, 1] into a multiplier, scaled to a maximum
 * effect. Keeps factor modules writing in terms of "how big is this, really"
 * instead of hand-tuning multipliers one at a time.
 */
export function effect(signedStrength: number, maxEffect = config.context.factorCap): number {
  return 1 + clamp(signedStrength, -1, 1) * maxEffect;
}

export interface StackResult {
  /** Final multiplier per channel per side, after the stack cap. */
  multipliers: Record<Channel, { home: number; away: number }>;
  /** Which factors actually moved something, for the ledger. */
  applied: Array<{ factorId: string; channel: Channel; side: Side; multiplier: number }>;
  /** True where the stack cap bit — worth surfacing, it means we clipped. */
  capped: Array<{ channel: Channel; side: Side; raw: number; capped: number }>;
}

/**
 * Combine every COMPUTED factor's adjustments into one multiplier per channel
 * and side, then clamp the total.
 *
 * Multiplying rather than adding matters: two factors that each reduce goals
 * by 10% should land at 0.81, not 0.80 exactly, and crucially can never push a
 * rate negative. The stack cap then stops a fixture with eight mild negatives
 * from compounding into a rate nobody would defend.
 */
export function stack(factors: Factor[]): StackResult {
  const channels: Channel[] = ['goals', 'corners', 'cards'];
  const multipliers = {} as StackResult['multipliers'];
  for (const c of channels) multipliers[c] = { home: 1, away: 1 };

  const applied: StackResult['applied'] = [];

  for (const f of factors) {
    if (f.state !== 'COMPUTED') continue;
    for (const a of f.adjustments) {
      if (a.multiplier === 1) continue;
      const sides: Array<'home' | 'away'> = a.side === 'both' ? ['home', 'away'] : [a.side];
      for (const s of sides) {
        multipliers[a.channel][s] *= a.multiplier;
        applied.push({ factorId: f.id, channel: a.channel, side: s, multiplier: a.multiplier });
      }
    }
  }

  const cap = config.context.stackCap;
  const capped: StackResult['capped'] = [];
  for (const c of channels) {
    for (const s of ['home', 'away'] as const) {
      const raw = multipliers[c][s];
      const limited = clamp(raw, 1 - cap, 1 + cap);
      if (Math.abs(limited - raw) > 1e-9) capped.push({ channel: c, side: s, raw, capped: limited });
      multipliers[c][s] = limited;
    }
  }

  return { multipliers, applied, capped };
}

/**
 * §8's tension rule. Two factors of equal tier pulling opposite ways on the
 * same channel is not something to average out — the doctrine is explicit that
 * it requires judgment, and absent judgment the honest answer is a pass.
 *
 * Only strongly-held factors count: a weak positive and a weak negative is
 * ordinary noise, not a genuine conflict.
 */
export interface Conflict {
  tier: Tier;
  channel: Channel;
  positive: Factor;
  negative: Factor;
}

export function findConflicts(factors: Factor[], minStrength = 0.6): Conflict[] {
  const conflicts: Conflict[] = [];
  const live = factors.filter((f) => f.state === 'COMPUTED' && f.strength >= minStrength);

  for (const channel of ['goals', 'corners', 'cards'] as Channel[]) {
    const byTier = new Map<Tier, Factor[]>();
    for (const f of live) {
      if (!f.adjustments.some((a) => a.channel === channel && a.multiplier !== 1)) continue;
      byTier.set(f.tier, [...(byTier.get(f.tier) ?? []), f]);
    }
    for (const [tier, group] of byTier) {
      const net = (f: Factor) =>
        f.adjustments
          .filter((a) => a.channel === channel)
          .reduce((acc, a) => acc + (a.multiplier - 1), 0);
      const ups = group.filter((f) => net(f) > 0.01);
      const downs = group.filter((f) => net(f) < -0.01);
      if (ups.length && downs.length) {
        // Report the strongest pair; listing every combination is noise.
        const positive = ups.reduce((a, b) => (b.strength > a.strength ? b : a));
        const negative = downs.reduce((a, b) => (b.strength > a.strength ? b : a));
        conflicts.push({ tier, channel, positive, negative });
      }
    }
  }
  return conflicts;
}

/** Count of COMPUTED factors in the tiers §12 calls dispositive. */
export function topTierCoverage(factors: Factor[]): number {
  return factors.filter((f) => f.state === 'COMPUTED' && f.tier <= 3).length;
}

/** A 0..1 summary of how much of the doctrine we actually managed to read. */
export function coverageScore(factors: Factor[]): number {
  if (factors.length === 0) return 0;
  // Tier 1 evidence is worth more than tier 6; weight accordingly.
  const weight = (t: Tier) => 8 - t;
  let got = 0;
  let possible = 0;
  for (const f of factors) {
    possible += weight(f.tier);
    if (f.state === 'COMPUTED') got += weight(f.tier);
  }
  return possible === 0 ? 0 : got / possible;
}

export function summarise(factors: Factor[]): Record<EvidenceState, number> {
  const out: Record<EvidenceState, number> = { COMPUTED: 0, THIN: 0, UNAVAILABLE: 0 };
  for (const f of factors) out[f.state]++;
  return out;
}
