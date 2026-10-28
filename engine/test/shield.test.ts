import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customRules, rateRules } from '../src/shield.ts';

/** The edge rules (edge:shield): the shape Cloudflare's API takes, within the free plan's limits. */

test('the custom rules block the crawlers and the fakes, and never the engine door', () => {
  const [crawlers, fakes] = customRules();
  assert.match(crawlers!.expression, /lower\(http\.user_agent\) contains "gptbot"/);
  assert.match(crawlers!.expression, /not http\.request\.uri\.path in \{"\/api\/internal\/db" "\/api\/pay\/webhook" "\/api\/auth\/email"\}/);
  assert.doesNotMatch(crawlers!.expression, /googlebot|bingbot/);
  assert.match(fakes!.expression, /contains "googlebot".* and not cf\.client\.bot$/);
  for (const r of customRules()) {
    assert.equal(r.action, 'block');
    assert.ok(r.description.startsWith('offside:'));
    // Cloudflare's limit on one rule's expression.
    assert.ok(r.expression.length < 4096, `${r.expression.length} characters`);
  }
});

test('the rate rule fits the free plan: ten seconds, by address', () => {
  for (const r of rateRules()) {
    assert.deepEqual(r.ratelimit, { characteristics: ['cf.colo.id', 'ip.src'], period: 10, requests_per_period: 150, mitigation_timeout: 10 });
    assert.match(r.expression, /\/api\/internal\/db/);
  }
  assert.match(rateRules()[0]!.expression, /^not cf\.client\.bot/);
});
