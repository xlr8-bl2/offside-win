/**
 * The free copy of a fixture.
 *
 * What a reader gets without a membership: the whole argument and none of the
 * conclusion. Form, team news, line-ups, head-to-head, the referee, the weather
 * and the written analysis all stay. The selection, the price and the bookmaker
 * do not.
 *
 * That split is not arbitrary. Ad review looks at the landing page rather than
 * the positioning, so the pages traffic arrives on have to carry no odds at all
 * -- and a reader who has just been talked into caring about a match is in a
 * better position to buy the answer than one shown a price up front.
 *
 * Two rules, and the second is the one that will save us:
 *
 *   1. An explicit list of what comes off each object. Readable, and it is
 *      where a deliberate decision gets recorded.
 *   2. A recursive sweep for PAID keys at any depth, applied afterwards. The
 *      first rule is a statement about the payload as it is today, and the
 *      payload grows. A field added to the bundle next month that happens to
 *      carry a price is stripped by the sweep without anyone remembering to
 *      come back here.
 *
 * The sweep fails closed on purpose. If it takes something it should not have,
 * a free reader sees a gap -- annoying, visible, fixed in a commit. The other
 * kind of mistake ships the product for nothing and nobody notices.
 */

import { findBannedInProse } from '../vocabulary.ts';

/**
 * Prose has to be judged on what it says, not on what it is called.
 *
 * The key sweep below is blind to the thing that actually leaks. Measured
 * against the live site, fifteen of fifteen narratives open by naming the call
 * and its price outright -- "Over 2.5 goals at 1.11." -- because the template
 * grammar builds that lead in at generation time. A paywall that strips
 * `top_pick` and then ships that sentence is decoration.
 *
 * So every piece of prose in the free copy is checked against the vocabulary
 * rule before it travels, and withheld if it fails. That is the same module the
 * writer validates against, which matters twice over: it catches the price, and
 * it catches the jargon that a free copy meant to advertise the product should
 * not be carrying either.
 *
 * The gate is on the content rather than on a flag, so it opens by itself. When
 * the narrative stops naming the call, these start passing and the free copy
 * fills in with no second switch to remember to throw.
 */
export function freeProse(text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  return findBannedInProse(text).length === 0 ? text : null;
}

/**
 * Keys that never appear in a free payload, wherever they are nested.
 *
 * Exported because engine/test/redact.test.ts asserts against this same set --
 * a test with its own copy of the list proves the list agrees with itself and
 * nothing else.
 */
export const PAID_KEYS: ReadonlySet<string> = new Set([
  // the call
  'top_pick', 'confident', 'verdict', 'candidate', 'candidates',
  // what it is a call on
  'market', 'markets', 'outcome', 'line',
  // what it pays, and who pays it
  'odds', 'odds_1x2', 'bookmaker', 'best', 'book',
  // the sizing, which implies the call even without naming it
  'kelly', 'edge', 'shrunk_edge',
]);

/** Factors about the price. They describe the thing being sold, so they wait. */
const PAID_FACTOR = /^market\./;

type Obj = Record<string, unknown>;

const omit = (o: Obj, keys: readonly string[]): Obj => {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v;
  return out;
};

/**
 * Strip every PAID key at any depth.
 *
 * Arrays are walked rather than copied wholesale, because the things worth
 * catching -- a verdict, a candidate, a market quote -- all live in them.
 */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== 'object') return value;

  const out: Obj = {};
  for (const [k, v] of Object.entries(value as Obj)) {
    if (PAID_KEYS.has(k)) continue;
    out[k] = scrub(v);
  }
  return out;
}

/**
 * Factors fit to be read for free.
 *
 * Two filters. The price factors go because they describe the thing being sold.
 * The rest go if their note fails the vocabulary rule -- a factor whose note is
 * withheld renders as a heading with nothing under it, which is worse than not
 * showing it at all, so the whole entry goes rather than being emptied.
 */
const freeFactors = (list: unknown): unknown =>
  Array.isArray(list)
    ? list.filter((f) => {
        const factor = f as Obj;
        if (PAID_FACTOR.test(String(factor?.['id'] ?? ''))) return false;
        return freeProse(factor?.['note']) !== null;
      })
    : list;

/** Everything the front end needs to render the wall rather than infer it. */
const LOCKED = { locked: true, plan: 'monthly' } as const;

/**
 * The board card, without the call.
 *
 * `confidence` deliberately stays. It is a bare number with no market attached,
 * so it gives a reader nothing to act on, and the board sorts its hero on it --
 * stripping it would quietly reorder the front page for everyone signed out,
 * which is the page that matters most. It should not be in either copy under
 * the vocabulary rule, and taking it out of both belongs in that change rather
 * than this one.
 */
export function freeBoard(board: Obj): Obj {
  return scrub({ ...omit(board, ['top_pick', 'confident', 'odds_1x2']), ...LOCKED }) as Obj;
}

/**
 * The fixture bundle, without the call.
 *
 * The verdict is opened up rather than dropped: `narrative` is the analysis and
 * is the whole reason someone is on the page, `drivers` is the evidence behind
 * it, and only `candidate` -- the selection, the line, the price and the book --
 * comes off. A reader gets the argument in full and pays for the answer.
 */
export function freeBundle(bundle: Obj): Obj {
  const verdicts = Array.isArray(bundle['verdicts'])
    ? bundle['verdicts'].map((v) => {
        const verdict = v as Obj;
        return {
          narrative: freeProse(verdict['narrative']),
          drivers: freeFactors(verdict['drivers']),
          set_aside: freeFactors(verdict['set_aside']),
        };
      })
    : [];

  const rest = omit(bundle, ['top_pick', 'confident', 'odds_1x2', 'markets', 'candidates', 'verdicts']);

  return scrub({
    ...rest,
    ledger: freeFactors(rest['ledger']),
    verdicts,
    ...LOCKED,
  }) as Obj;
}
