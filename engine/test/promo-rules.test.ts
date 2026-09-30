import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Who is shown an offer and which one checkout applies (public/js/lib/promo.js).
 *
 * The rules the Worker enforces at payment (a member cannot use an offer; a
 * free trial is for new members only) decide what is dangled in front of a
 * reader, so nobody is sold something checkout will refuse. And the offer a
 * reader clicked is the one checkout applies, even when its audience was
 * "signed-out visitors" and they have since signed in to take it.
 */

// @ts-expect-error plain ES module from the site
const promo = await import('../../public/js/lib/promo.js');

const deal = { id: 'd1', kind: 'deal', plan_id: 'monthly', audience: 'signed_out', price_minor: 500 };
const trial = { id: 't1', kind: 'trial', plan_id: 'quarter', audience: 'everyone', trial_days: 7 };
const notice = { id: 'n1', kind: 'notice', plan_id: null, audience: 'everyone' };

test('a member is shown notices only', () => {
  const who = { signedIn: true, member: true, returning: true };
  assert.deepEqual([deal, trial, notice].filter((p) => promo.eligible(p, who)).map((p) => p.id), ['n1']);
});

test('a reader who has had a membership before is never shown a free trial', () => {
  assert.equal(promo.eligible(trial, { signedIn: true, member: false, returning: true }), false);
  assert.equal(promo.eligible(trial, { signedIn: true, member: false, returning: false }), true);
});

test('a signed-out offer is shown signed out and still applies once they sign in to take it', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify([deal, trial, notice]))) as typeof fetch;
  assert.equal(promo.eligible(deal, { signedIn: false, member: false }), true);
  assert.equal(promo.eligible(deal, { signedIn: true, member: false }), false);
  const who = { signedIn: true, member: false, returning: false };
  assert.equal((await promo.offerForPlan('monthly', who, 'd1'))?.id, 'd1');
  assert.equal(await promo.offerForPlan('monthly', who), null, 'without the click it is not pushed at a signed-in reader');
  assert.equal(await promo.offerForPlan('monthly', { ...who, member: true }, 'd1'), null, 'a member cannot use it');
  assert.equal(await promo.offerForPlan('quarter', { ...who, returning: true }, 't1'), null, 'nor a returning reader a trial');
  assert.equal((await promo.offerForPlan('quarter', who, 'd1'))?.id, 't1', 'an id for another plan falls back to that plan\'s own offer');
});
