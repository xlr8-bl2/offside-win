import { clamp, computed, thin } from '../ledger.ts';
import type { Claim, Factor } from '../types.ts';
import type { FixtureContext, SideContext } from './types.ts';

/**
 * §2.1 — how a side has actually been playing.
 *
 * This module exists because of a gap that shaped every sentence the site
 * published. The engine knew a team's fitted rating, its expected goals, its
 * rest and its league position, and it knew nothing about *form* — the run of
 * results a supporter would open with. `side.recent` has been sitting in the
 * context the whole time, read only for counting rest days.
 *
 * The consequence was that every explanation opened on a number. "Real Betis are
 * meaningfully the stronger side on expected goals, 1.60 to 0.89" is true and it
 * is not how anybody talks about a football match. An argument starts with who
 * these teams are right now, and that is what this produces.
 *
 * Deliberately **no rate adjustment**. The ratings are already fitted on these
 * same results with time decay; adding a form multiplier on top would count the
 * same evidence twice, in the direction the doctrine says reverts. This is a
 * narrative factor — it explains the model rather than moving it — and the
 * `adjustments: []` below is the enforcement of that.
 */

/** Matches to read. Six is the window a run is normally described over. */
const WINDOW = 6;
/** Below this there is no run to describe, only noise. */
const MIN_MATCHES = 4;

export interface FormRead {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  ppg: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  /** Unbeaten or winless streak, counted from the most recent match back. */
  streak: { kind: 'won' | 'unbeaten' | 'lost' | 'winless' | 'none'; length: number };
  /** The same read restricted to this side's home or away matches. */
  venue: { played: number; ppg: number; goalsFor: number; goalsAgainst: number } | null;
}

/**
 * Read a side's recent results.
 *
 * `atHome` selects which half of the venue split matters: the side playing at
 * home is described by its home record, the visitor by its away record. That
 * split is the whole point — "they travel badly" is a claim about away form, and
 * a season average cannot make it.
 */
export function readForm(side: SideContext, atHome: boolean): FormRead | null {
  const played = (side.recent ?? [])
    .filter((m) => m.home_goals !== null && m.away_goals !== null)
    .slice(0, WINDOW);
  if (played.length < MIN_MATCHES) return null;

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let cleanSheets = 0;
  const outcomes: Array<'W' | 'D' | 'L'> = [];

  const venueRows: Array<{ pts: number; gf: number; ga: number }> = [];

  for (const m of played) {
    const home = m.home_team_id === side.team_id;
    const gf = home ? m.home_goals! : m.away_goals!;
    const ga = home ? m.away_goals! : m.home_goals!;
    goalsFor += gf;
    goalsAgainst += ga;
    if (ga === 0) cleanSheets++;
    const res = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
    outcomes.push(res);
    if (res === 'W') wins++;
    else if (res === 'D') draws++;
    else losses++;
    if (home === atHome) venueRows.push({ pts: res === 'W' ? 3 : res === 'D' ? 1 : 0, gf, ga });
  }

  const n = played.length;
  return {
    played: n,
    wins,
    draws,
    losses,
    ppg: (wins * 3 + draws) / n,
    goalsFor: goalsFor / n,
    goalsAgainst: goalsAgainst / n,
    cleanSheets,
    streak: streakOf(outcomes),
    venue: venueRows.length >= 2
      ? {
          played: venueRows.length,
          ppg: venueRows.reduce((s, r) => s + r.pts, 0) / venueRows.length,
          goalsFor: venueRows.reduce((s, r) => s + r.gf, 0) / venueRows.length,
          goalsAgainst: venueRows.reduce((s, r) => s + r.ga, 0) / venueRows.length,
        }
      : null,
  };
}

/**
 * The run, counted back from the most recent match.
 *
 * Reported as the strongest true description rather than the longest: three
 * straight wins is "won three", not "unbeaten in three", because the weaker
 * phrasing understates what happened. Two of anything is not a run.
 */
export function streakOf(outcomes: Array<'W' | 'D' | 'L'>): FormRead['streak'] {
  if (outcomes.length === 0) return { kind: 'none', length: 0 };
  const run = (pred: (o: 'W' | 'D' | 'L') => boolean): number => {
    let i = 0;
    while (i < outcomes.length && pred(outcomes[i]!)) i++;
    return i;
  };
  const won = run((o) => o === 'W');
  if (won >= 3) return { kind: 'won', length: won };
  const lost = run((o) => o === 'L');
  if (lost >= 3) return { kind: 'lost', length: lost };
  const unbeaten = run((o) => o !== 'L');
  if (unbeaten >= 4) return { kind: 'unbeaten', length: unbeaten };
  const winless = run((o) => o !== 'W');
  if (winless >= 4) return { kind: 'winless', length: winless };
  return { kind: 'none', length: 0 };
}

export function formFactors(ctx: FixtureContext): Factor[] {
  return [sideForm(ctx, 'home'), sideForm(ctx, 'away')];
}

function sideForm(ctx: FixtureContext, which: 'home' | 'away'): Factor {
  const side: SideContext = ctx[which];
  const atHome = which === 'home';
  const form = readForm(side, atHome);

  if (!form) {
    return thin({
      id: `form.${which}`,
      section: '§2.1',
      tier: 2,
      note: `Too few recent results on record for ${side.team_name} to read their form.`,
      evidence: { matches: (side.recent ?? []).length },
    });
  }

  const where = atHome ? 'at home' : 'on the road';
  const note =
    `${side.team_name} have taken ${form.ppg.toFixed(2)} points a game from their last ` +
    `${form.played} — ${form.wins}W ${form.draws}D ${form.losses}L, scoring ` +
    `${form.goalsFor.toFixed(1)} and conceding ${form.goalsAgainst.toFixed(1)}` +
    (form.venue ? `, and ${form.venue.ppg.toFixed(2)} a game ${where}.` : '.');

  const claims: Claim[] = [
    {
      subject: side.team_name,
      predicate: 'form_run',
      polarity: form.ppg >= 1.5 ? 1 : -1,
      // A side on 2.5 points a game is as far from average as one on 0.5.
      magnitude: clamp(Math.abs(form.ppg - 1.35) / 1.15, 0.2, 1),
      evidence: {
        team: side.team_name,
        matches: form.played,
        wins: form.wins,
        draws: form.draws,
        losses: form.losses,
        ppg: Number(form.ppg.toFixed(2)),
        goals_for: Number(form.goalsFor.toFixed(2)),
        goals_against: Number(form.goalsAgainst.toFixed(2)),
        clean_sheets: form.cleanSheets,
        streak_kind: form.streak.kind,
        streak_length: form.streak.length,
        where,
        ...(form.venue
          ? {
              venue_matches: form.venue.played,
              venue_ppg: Number(form.venue.ppg.toFixed(2)),
              venue_goals_for: Number(form.venue.goalsFor.toFixed(2)),
              venue_goals_against: Number(form.venue.goalsAgainst.toFixed(2)),
            }
          : {}),
      },
      section: '§2.1',
      tier: 2,
    },
  ];

  return computed({
    id: `form.${which}`,
    section: '§2.1',
    tier: 2,
    note,
    evidence: {
      matches: form.played,
      ppg: Number(form.ppg.toFixed(2)),
      record: `${form.wins}-${form.draws}-${form.losses}`,
      goals_for: Number(form.goalsFor.toFixed(2)),
      goals_against: Number(form.goalsAgainst.toFixed(2)),
      clean_sheets: form.cleanSheets,
      streak: form.streak.kind === 'none' ? 'none' : `${form.streak.kind} ${form.streak.length}`,
      ...(form.venue ? { venue_ppg: Number(form.venue.ppg.toFixed(2)) } : {}),
    },
    // None. The ratings are fitted on these same results with time decay, so a
    // form multiplier would count them twice — see the module note above.
    adjustments: [],
    claims,
    strength: clamp(Math.abs(form.ppg - 1.35) / 1.5, 0.15, 0.7),
  });
}

export const _internals = { streakOf, readForm };
