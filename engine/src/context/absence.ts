/**
 * Why a player is out, in words: the engine's copy of
 * public/js/lib/absence.js, so the analysis writer reads "with the national
 * team" rather than "national_team". engine/test/absence.test.ts keeps the
 * two in step.
 */
const NON_ANSWERS = /^(unknown|other|undisclosed|n\/?a|none|missing|not specified|unspecified|-)$/;

export function absenceReason(raw: unknown): string | null {
  const t = String(raw ?? '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || NON_ANSWERS.test(t)) return null;
  if (/national team|international (duty|call ?up)|^international$/.test(t)) return 'With the national team';
  if (/red card/.test(t) && /susp/.test(t)) return 'Suspended (red card)';
  if (/(yellow card|bookings?|accumulat)/.test(t) && /susp/.test(t)) return 'Suspended (bookings)';
  if (/susp/.test(t)) return 'Suspended';
  if (/^(ill|illness|sick|sickness|virus|flu)$/.test(t)) return 'Ill';
  if (/personal|family/.test(t)) return 'Personal reasons';
  if (/paternity|birth/.test(t)) return 'Paternity leave';
  if (/coach|manager|tactical|not selected|left out|squad decision/.test(t)) return 'Left out';
  if (/^rest(ed)?$/.test(t)) return 'Rested';
  if (/ineligib|not eligible|loan/.test(t)) return 'Not eligible';
  if (/^doubtful$/.test(t)) return 'Doubtful';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
