import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absenceReason } from '../src/context/absence.ts';
// @ts-expect-error -- the browser copy, plain JS
import { absenceReason as browser } from '../../public/js/lib/absence.js';

const cases: Array<[unknown, string | null]> = [
  ['national_team', 'With the national team'],
  ['International duty', 'With the national team'],
  ['red_card_suspension', 'Suspended (red card)'],
  ['yellow_card_accumulation_suspension', 'Suspended (bookings)'],
  ['Suspended', 'Suspended'],
  ['Hamstring Injury', 'Hamstring injury'],
  ['Broken Foot', 'Broken foot'],
  ['Heart Problems', 'Heart problems'],
  ['personal_reasons', 'Personal reasons'],
  ['illness', 'Ill'],
  ['Unknown', null],
  ['', null],
  [null, null],
];

for (const [raw, want] of cases) {
  test(`absence reason: ${JSON.stringify(raw)}`, () => {
    assert.equal(absenceReason(raw), want);
    assert.equal(browser(raw), want, 'the browser copy disagrees with the engine copy');
  });
}
