import { config } from '../config.ts';
import { marketLabel } from '../select.ts';
import type { Candidate, Claim, Factor } from '../types.ts';
import { CONNECTIVES, FRAMES, choose, tryFrame, type Rng } from './grammar.ts';

/**
 * Composing a pick's explanation.
 *
 * The job is to turn computed claims into a short paragraph that a reader can
 * check against the evidence, and to do it without every pick sounding like the
 * last one. Three mechanisms:
 *
 * 1. **Seeded but varied.** The generator is seeded from the fixture and market,
 *    so the same pick always reads the same way — regenerating a slate does not
 *    silently rewrite yesterday's reasoning — while different picks diverge.
 * 2. **An anti-repetition ledger.** Frames used recently are excluded, and the
 *    ledger spans the whole slate, so two fixtures on the same day cannot open
 *    with the same construction.
 * 3. **Connectives that match the logic.** A claim that reinforces the previous
 *    one joins differently from one that cuts against it. That is not decoration:
 *    it is how the reader learns the model saw the tension rather than ignoring
 *    it.
 */

/** xmur3 + mulberry32: a small, well-distributed seeded PRNG. */
export function seededRng(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Remembers which frames have been used lately so the next pick can avoid them.
 * Bounded, because unbounded avoidance eventually leaves nothing to choose from.
 */
export class RepetitionLedger {
  private used: string[] = [];
  private readonly limit: number;

  constructor(limit = config.narrate.ledgerSize, seed: string[] = []) {
    this.limit = limit;
    this.used = seed.slice(-limit);
  }

  /** Frame indices to steer away from for this predicate. */
  avoidFor(predicate: string, frameCount: number): Set<number> {
    const recent = new Set<number>();
    // Only the most recent few matter; avoiding everything ever used would
    // exhaust the grammar and force repetition anyway.
    const window = Math.max(1, Math.min(frameCount - 1, Math.ceil(frameCount / 2)));
    let seen = 0;
    for (let i = this.used.length - 1; i >= 0 && seen < window; i--) {
      const entry = this.used[i]!;
      const [p, idx] = entry.split(':');
      if (p === predicate) {
        recent.add(Number(idx));
        seen++;
      }
    }
    return recent;
  }

  record(predicate: string, index: number): void {
    this.used.push(`${predicate}:${index}`);
    if (this.used.length > this.limit) this.used.splice(0, this.used.length - this.limit);
  }

  snapshot(): string[] {
    return this.used.slice();
  }
}

/**
 * Rank claims by how much they should influence what the reader is told.
 *
 * §12's hierarchy decides first — availability before stakes before regime — and
 * magnitude breaks ties within a tier. A tier-1 absence outranks a tier-7 line
 * move even when the line move is larger, because that is the order in which the
 * doctrine says these things matter.
 */
export function rankClaims(claims: Claim[]): Claim[] {
  return [...claims].sort((a, b) => a.tier - b.tier || b.magnitude - a.magnitude);
}

/**
 * Pick the claims to use, preferring variety of subject matter. Three sentences
 * about three absences is a worse paragraph than one about an absence, one about
 * the schedule and one about the price.
 */
export function selectClaims(claims: Claim[], max: number): Claim[] {
  const ranked = rankClaims(claims);
  const chosen: Claim[] = [];
  const usedPredicates = new Set<string>();

  for (const c of ranked) {
    if (chosen.length >= max) break;
    if (usedPredicates.has(c.predicate)) continue;
    chosen.push(c);
    usedPredicates.add(c.predicate);
  }
  // Backfill if the variety rule left us short.
  for (const c of ranked) {
    if (chosen.length >= max) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  return chosen;
}

/**
 * Lowercase a sentence's first word so it can follow a connective — unless that
 * word is a name. Joining with "Alongside it, brighton play their fourth match"
 * reads as a typo and undoes the credibility the specificity was there to buy.
 *
 * The proper nouns are collected from the claims themselves rather than guessed
 * at, so this works for any team, player or manager the data contains without a
 * hardcoded list.
 */
export function properNouns(claims: Claim[], ...extra: string[]): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'string' || v.length === 0) return;
    // Index the first word too, since that is what gets decapitalised.
    out.add(v);
    const first = v.split(/\s+/)[0];
    if (first) out.add(first);
  };
  for (const c of claims) {
    add(c.subject);
    for (const key of ['team', 'opponent', 'manager', 'home', 'away']) add(c.evidence[key]);
  }
  for (const e of extra) add(e);
  return out;
}

function joinAfterConnective(sentence: string, nouns: Set<string>): string {
  const firstWord = sentence.split(/[\s,.;:—]/)[0] ?? '';
  if (nouns.has(firstWord)) return sentence;
  // Also leave acronyms and initialisms alone.
  if (/^[A-Z]{2,}$/.test(firstWord)) return sentence;
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

function connectiveFor(prev: Claim, next: Claim, rng: Rng): string {
  if (prev.polarity === 0 || next.polarity === 0) return choose(CONNECTIVES.neutral as unknown as string[], rng).item;
  return prev.polarity === next.polarity
    ? choose(CONNECTIVES.reinforcing as unknown as string[], rng).item
    : choose(CONNECTIVES.opposing as unknown as string[], rng).item;
}

export interface NarrateInput {
  candidate: Candidate;
  drivers: Factor[];
  homeTeam: string;
  awayTeam: string;
  fixtureId: number;
  ledger: RepetitionLedger;
}

/**
 * Turn one claim into one sentence, or into nothing.
 *
 * Frames are tried in the order the ledger prefers, and a frame whose evidence
 * the claim does not carry is skipped rather than rendered with zeros in the
 * gaps. If no frame can be written truthfully the claim is dropped — a silent
 * omission is a smaller failure than a confident sentence about nothing, and
 * §13 would rather say less than say something unearned.
 */
function renderClaim(claim: Claim, rng: Rng, ledger: RepetitionLedger): string | null {
  const frames = FRAMES[claim.predicate];
  if (!frames || frames.length === 0) return null;

  const avoid = ledger.avoidFor(claim.predicate, frames.length);
  const all = frames.map((_, i) => i);
  const preferred = all.filter((i) => !avoid.has(i));

  // `choose` returns a position within the array it is handed, so it is given
  // the index list and its `item` — the frame index — is what to use. Reading
  // its `index` instead silently defeated the ledger and let two consecutive
  // picks open with the same construction.
  const first = (preferred.length ? choose(preferred, rng) : choose(all, rng)).item;

  // Preferred frames first, then the ones the ledger wanted to avoid: repeating
  // a construction is a smaller loss than dropping a real reason because its
  // freshest phrasing happened to need evidence this claim lacks.
  const order = [first, ...preferred.filter((i) => i !== first), ...all.filter((i) => i !== first && !preferred.includes(i))];

  for (const i of order) {
    const out = tryFrame(frames[i]!, claim, rng);
    if (out !== null) {
      ledger.record(claim.predicate, i);
      return out;
    }
  }
  return null;
}

/**
 * Build the sentence that states the bet itself, with our number against the
 * market's. This always appears, because a reader should never have to infer
 * what was actually being recommended.
 */
function verdictSentence(c: Candidate, rng: Rng, ledger: RepetitionLedger): string {
  const claim: Claim = {
    subject: 'the model',
    predicate: 'rating_gap',
    polarity: 1,
    magnitude: Math.min(1, Math.abs(c.edge) / 0.12),
    evidence: {
      model_pct: c.model_prob * 100,
      book_pct: c.book_prob * 100,
      edge_points: c.edge * 100,
    },
    section: '§7.3',
    tier: 7,
  };
  // rating_gap frames only cite model_pct, book_pct and edge_points, all set
  // just above, so this cannot come back null in practice — the fallback is
  // there so a future frame with a new key degrades to a plain statement rather
  // than to an empty string.
  return (
    renderClaim(claim, rng, ledger) ??
    `We make it ${(c.model_prob * 100).toFixed(1)}% against the market's ${(c.book_prob * 100).toFixed(1)}%.`
  );
}

export function narrate(input: NarrateInput): string {
  const { candidate, drivers, ledger } = input;
  const rng = seededRng(
    `${input.fixtureId}:${candidate.market}:${candidate.outcome}:${candidate.line ?? 'x'}`,
  );

  const claims = selectClaims(
    drivers.flatMap((d) => d.claims),
    config.narrate.maxClaims,
  );

  const nouns = properNouns(claims, input.homeTeam, input.awayTeam);
  const sentences: string[] = [];
  let previous: Claim | null = null;

  for (const claim of claims) {
    const rendered = renderClaim(claim, rng, ledger);
    if (rendered === null) continue;

    let sentence = rendered;
    if (previous) {
      sentence = connectiveFor(previous, claim, rng) + joinAfterConnective(sentence, nouns);
    }
    sentences.push(sentence);
    previous = claim;
  }

  // No claims cleared: say what the bet is and be honest that the case rests on
  // the numbers rather than on a story.
  if (sentences.length === 0) {
    return (
      `${capitalise(marketLabel(candidate))} at ${candidate.odds.toFixed(2)}. ` +
      `${verdictSentence(candidate, rng, ledger)} ` +
      `No single contextual factor drives this — it is a pricing disagreement rather than a narrative one.`
    );
  }

  const lead = `${capitalise(marketLabel(candidate))} at ${candidate.odds.toFixed(2)}.`;
  return [lead, ...sentences, verdictSentence(candidate, rng, ledger)].join(' ');
}

/**
 * The explanation for a pass. §13 treats a pass as the analysis working, so it
 * gets a real sentence rather than an empty state.
 */
export function narratePass(reason: string, homeTeam: string, awayTeam: string, fixtureId: number): string {
  const rng = seededRng(`pass:${fixtureId}`);
  const openers = [
    `No call on ${homeTeam} against ${awayTeam}.`,
    `Passing on ${homeTeam} v ${awayTeam}.`,
    `${homeTeam} v ${awayTeam} is one to leave alone.`,
    `Nothing to take on ${homeTeam} against ${awayTeam}.`,
  ];
  return `${choose(openers, rng).item} ${reason}`;
}

function capitalise(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export const _internals = { connectiveFor, capitalise, joinAfterConnective };

// ------------------------------------------------------- confidence calls

export interface ConfidentInput {
  candidate: Candidate;
  drivers: Factor[];
  homeTeam: string;
  awayTeam: string;
  fixtureId: number;
  ledger: RepetitionLedger;
  /** The provider's expected goals, which carry the mismatch this call reads. */
  expectedGoals: { home: number; away: number } | null;
}

/**
 * Turn a sentence into a clause that can follow "It is not a clean case: ".
 *
 * Lowercasing the first character blindly mangles a name — the live board
 * produced "deportivo Alavés have had only 3.3 days" and "aFC Ajax have had
 * only 3.0 days". A first word is only safe to lowercase when it is ordinary
 * prose: not a team name, and not an acronym or mixed-case token like AFC or
 * FC that carries capitals past the first letter.
 */
function asClause(sentence: string, properNouns: string[]): string {
  const body = sentence.replace(/\.$/, '');
  const first = body.split(/\s+/)[0] ?? '';
  const isName =
    properNouns.some((name) => name && body.startsWith(name)) ||
    // A capital anywhere past the first letter marks an acronym or a
    // compound name: AFC, FC, McTominay.
    /[A-Z]/.test(first.slice(1)) ||
    !/^[A-Z][a-z]/.test(first) ||
    // Two capitalised words in a row is a name almost every time, and the cost
    // of being wrong is a missing lowercase rather than a mangled surname.
    /^[A-Z][a-z'-]+ [A-Z]/.test(body);
  return isName ? body : body[0]!.toLowerCase() + body.slice(1);
}

/**
 * Outcomes whose bet wins when the thing in question happens *less*.
 *
 * A factor that suppresses goals argues against "over 2.5" and for "under 2.5",
 * so the claim polarity has to be read through the direction of the bet or the
 * supporting and opposing sentences arrive swapped — which would be worse than
 * saying nothing, because it reads as confident and is backwards.
 */
function isSuppressingBet(c: Candidate): boolean {
  return c.outcome === 'under' || c.outcome === 'no';
}

/**
 * The mismatch sentence: why this is lopsided, in expected goals.
 *
 * Returns null when the provider gave no expected goals, rather than inventing
 * a case. A confidence call with no stated mismatch falls back to its context
 * claims, and if it has none either it says so — see below.
 */
function strengthGapClaim(input: ConfidentInput): Claim | null {
  const xg = input.expectedGoals;
  if (!xg || xg.home <= 0 || xg.away <= 0) return null;

  // Which side the bet is on decides which way the sentence is written. For a
  // goals-total bet there is no side, so the stronger team leads and the
  // sentence is about the shape of the match rather than about a winner.
  const backsHome =
    input.candidate.outcome === 'HOME' || input.candidate.outcome === '1X';
  const backsAway =
    input.candidate.outcome === 'AWAY' || input.candidate.outcome === 'X2';
  const homeLeads = backsHome || (!backsAway && xg.home >= xg.away);

  // A goals total or BTTS has no side to be stronger. Asking the strength_gap
  // frames to describe it produced sentences arguing for the wrong outcome.
  if (!backsHome && !backsAway) {
    const total = xg.home + xg.away;
    return {
      subject: 'the match',
      predicate: 'match_shape',
      polarity: 1,
      magnitude: Math.min(1, Math.abs(xg.home - xg.away) / 1.6),
      evidence: {
        total,
        xg_home: xg.home,
        xg_away: xg.away,
        home: input.homeTeam,
        away: input.awayTeam,
        ...(input.candidate.line !== null ? { line: input.candidate.line } : {}),
      },
      section: '§7.1',
      tier: 1,
    };
  }

  const forGoals = homeLeads ? xg.home : xg.away;
  const againstGoals = homeLeads ? xg.away : xg.home;
  const ratio = againstGoals > 0 ? forGoals / againstGoals : forGoals;

  return {
    subject: homeLeads ? input.homeTeam : input.awayTeam,
    predicate: 'strength_gap',
    polarity: 1,
    magnitude: Math.min(1, Math.abs(forGoals - againstGoals) / 1.6),
    evidence: {
      team: homeLeads ? input.homeTeam : input.awayTeam,
      opponent: homeLeads ? input.awayTeam : input.homeTeam,
      xg_for: forGoals,
      xg_against: againstGoals,
      ratio,
    },
    section: '§7.1',
    tier: 1,
  };
}

/** The verdict: the number, the price, and what the price means. */
function confidenceVerdict(c: Candidate): Claim {
  return {
    subject: 'the call',
    predicate: 'confidence_case',
    polarity: 1,
    magnitude: c.model_prob,
    evidence: {
      prob_pct: c.model_prob * 100,
      odds: c.odds,
      // What a winning bet actually hands back, which is the fact a hit rate
      // hides. 86% at 1.16 returns 16p in the pound.
      return_pct: (c.odds - 1) * 100,
    },
    section: '§7.3',
    tier: 7,
  };
}

/**
 * Explain a high-confidence call.
 *
 * Structurally different from `narrate` above, because the argument is
 * different: there is no pricing disagreement to point at, so the case has to
 * be the match itself. Order is fixed — what the bet is, why the mismatch
 * exists, what supports it, what cuts against it, what it pays — because a
 * reader scanning twenty of these needs the same shape every time, and the
 * variation belongs inside the sentences rather than in their arrangement.
 *
 * The counterweight is the part worth protecting. Anyone can publish a favourite
 * at 86%; saying out loud what the 86% has not accounted for is the only reason
 * to read ours instead of theirs.
 */
export function narrateConfident(input: ConfidentInput): string {
  const { candidate, drivers, ledger } = input;
  const rng = seededRng(
    `conf:${input.fixtureId}:${candidate.market}:${candidate.outcome}:${candidate.line ?? 'x'}`,
  );

  // Polarity on a claim is "does this suppress or promote the thing happening".
  // For a bet that wins when the thing happens *less*, that reading inverts, and
  // the connectives have to see the inverted value too — otherwise rain, which
  // supports an under, gets introduced with "Cutting the other way".
  const flip = isSuppressingBet(candidate) ? -1 : 1;
  const orient = (c: Claim): Claim =>
    flip === 1 ? c : { ...c, polarity: (c.polarity * -1) as Claim['polarity'] };

  const all = drivers.flatMap((d) => d.claims).map(orient);
  const supporting = selectClaims(
    all.filter((c) => c.polarity > 0),
    Math.max(1, config.narrate.maxClaims - 1),
  );
  const against = selectClaims(all.filter((c) => c.polarity < 0), 1);

  const render = (claim: Claim): string | null => renderClaim(claim, rng, ledger);

  const sentences: string[] = [];

  const gap = strengthGapClaim(input);
  if (gap) {
    const s = render(gap);
    if (s) sentences.push(s);
  }

  const nouns = properNouns([...supporting, ...against], input.homeTeam, input.awayTeam);
  let previous: Claim | null = gap;
  for (const claim of supporting) {
    const s = render(claim);
    if (!s) continue;
    sentences.push(previous ? connectiveFor(previous, claim, rng) + joinAfterConnective(s, nouns) : s);
    previous = claim;
  }

  // The counterweight gets its own predicate rather than a connective, because
  // it is doing a different job from "and also": it is the reservation, and it
  // should read like one.
  for (const claim of against) {
    const detail = render(claim);
    if (!detail) continue;
    const framed = render({
      subject: claim.subject,
      predicate: 'counterweight',
      polarity: -1,
      magnitude: claim.magnitude,
      // The inner sentence is lowercased so it reads as a clause rather than as
      // a second sentence bolted on.
      // The claim's own subject matters as much as the team names: a
      // counterweight usually opens on the player it is about, and the first
      // pass of this produced "viktor Gyokeres is out".
      evidence: {
        detail: asClause(detail, [input.homeTeam, input.awayTeam, claim.subject, String(claim.evidence.team ?? '')]),
      },
      section: claim.section,
      tier: claim.tier,
    });
    if (framed) sentences.push(framed);
  }

  const lead = `${capitalise(marketLabel(candidate))} at ${candidate.odds.toFixed(2)}.`;
  const verdict = render(confidenceVerdict(candidate));

  // Nothing contextual cleared: say that, rather than dressing a bare number in
  // adjectives. §13 — thin evidence is stated as thin.
  if (sentences.length === 0) {
    return [
      lead,
      `The case here is the matchup itself rather than anything we can point at — no contextual factor cleared its evidence bar for this fixture.`,
      verdict ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [lead, ...sentences, verdict ?? ''].filter(Boolean).join(' ');
}
