/**
 * Why a player is out, in words.
 *
 * The feed sends a mix: "Hamstring Injury", "Broken Foot", but also raw codes
 * such as "national_team" and "red_card_suspension", and "Unknown" when it
 * does not know. Printed as they came, the team sheet read "national_team".
 * This turns every one into a phrase a reader would say, and returns null for
 * the non-answers, so the page shows no reason rather than a placeholder.
 *
 * engine/src/context/absence.ts is the same function for the analysis
 * writer; engine/test/absence.test.ts checks the two agree.
 */
const NON_ANSWERS = /^(unknown|other|undisclosed|n\/?a|none|missing|not specified|unspecified|-)$/;

export function absenceReason(raw) {
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
