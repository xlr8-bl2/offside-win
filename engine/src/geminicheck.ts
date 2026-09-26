/**
 * Ask Gemini directly what it thinks of the key, and print its answer. For
 * when the slate says "Google says the daily limit is reached" on a key that
 * should have plenty: which models the key can see, and Google's own words for
 * one tiny request, including which quota it named.
 *
 * Prints statuses, model names and Google's error fields. Never the key.
 */

import { DEFAULT_MODEL } from './narrate/gemini.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function geminiCheck(): Promise<void> {
  const key = process.env['GEMINI_API_KEY'] ?? '';
  if (!key) throw new Error('GEMINI_API_KEY is not set in Actions secrets');
  const model = process.env['GEMINI_MODEL'] || DEFAULT_MODEL;
  const headers = { 'x-goog-api-key': key, 'content-type': 'application/json' };

  const list = await fetch(`${BASE}?pageSize=200`, { headers });
  const lj = await list.json().catch(() => null) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }>; error?: unknown } | null;
  console.log('models list:', list.status);
  if (!list.ok) console.log('  error:', JSON.stringify(lj?.error ?? lj).slice(0, 500));
  const flash = (lj?.models ?? [])
    .filter((m) => /flash/.test(m.name) && m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  console.log('  flash models this key can call:', flash.join(', ') || 'none');
  console.log('  configured model:', model, flash.includes(model) ? '(listed)' : '(NOT listed)');

  // One tiny request per candidate: the configured model first, then the
  // newest few flash models, so a quota refusal on one can be told apart
  // from a key that has none at all.
  const tries = [model, ...flash.filter((m) => m !== model && !/image|tts|audio|live|embed/.test(m)).slice(0, 4)];
  for (const m of tries) {
    const res = await fetch(`${BASE}/${m}:generateContent`, {
      method: 'POST', headers,
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: ready' }] }], generationConfig: { maxOutputTokens: 256 } }),
    });
    const body = await res.json().catch(() => null) as any;
    if (res.ok) {
      const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim();
      console.log(`generate ${m}: ${res.status} ok, said "${text.slice(0, 40)}"`);
      continue;
    }
    const e = body?.error ?? {};
    const quota = (e.details ?? []).flatMap((d: any) => d.violations ?? [])
      .map((v: any) => `${v.quotaId ?? v.quotaMetric ?? '?'}=${v.quotaValue ?? '?'}${v.quotaDimensions?.model ? ` (${v.quotaDimensions.model})` : ''}`);
    const retry = (e.details ?? []).find((d: any) => d.retryDelay)?.retryDelay;
    console.log(`generate ${m}: ${res.status} ${e.status ?? ''} ${String(e.message ?? '').slice(0, 300)}`);
    if (quota.length) console.log(`  quota named: ${quota.join('; ')}`);
    if (retry) console.log(`  retry after: ${retry}`);
  }
}
