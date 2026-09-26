/**
 * Gemini, on the free tier.
 *
 * Chosen because it costs nothing and the volume fits comfortably: we write
 * roughly 120 fixtures a day, paced well inside a workflow allowed two hours.
 *
 * THE MODEL NAME IS NOT A CONSTANT. The first real run failed every call with
 * a 404 -- "this model is no longer available to new users" -- because the
 * name written here when this was designed had since been retired. Google
 * moves them, so it is an environment variable with a current default rather
 * than something baked in, and the error now says which name was refused.
 *
 * Two consequences of the free tier shape the code rather than just the choice:
 *
 *   Batch mode is paid-tier only, so this is paced sequential requests and not
 *   a submit-and-poll. The limiter below is the same shape as the one in
 *   bsd.ts — a slot that is released while waiting rather than held. The rate
 *   is configurable because published free limits differ by model and region
 *   and have been revised more than once.
 *
 *   Google has cut free quotas sharply and without notice before. A 429 is
 *   therefore an expected condition, not an emergency: it returns an error,
 *   the caller falls back to the template grammar, and the run logs how often
 *   that happened. The site keeps publishing in the old voice rather than
 *   publishing nothing.
 *
 * No SDK. One POST to one endpoint does not justify a dependency, and the
 * engine has exactly one runtime dependency today.
 */

import type { Writer } from './write.ts';

const BASE = process.env['GEMINI_BASE']
  ?? 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The current free Flash model.
 *
 * Retired names 404 rather than falling back to something that works, so when
 * Google moves this on again the symptom is every narrative reverting to the
 * template grammar with a 404 in the run log naming the replacement.
 */
export const DEFAULT_MODEL = 'gemini-3.6-flash';

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /** Requests per minute. Paced conservatively; free limits vary by model. */
  ratePerMinute?: number;
  timeoutMs?: number;
}

/** How many times to wait out a busy model before giving up on a call. */
const RETRY_ON_BUSY = 2;

export class QuotaExhausted extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExhausted';
  }
}

/**
 * A spacer rather than a token bucket.
 *
 * The allowance is per minute and the work is a long sequential run, so the
 * useful behaviour is a minimum gap between calls. A bucket would let the first
 * fifteen through at once and then stall for a minute, which is slower overall
 * and much more likely to trip the limit.
 */
function spacer(perMinute: number) {
  const gap = Math.ceil(60_000 / Math.max(1, perMinute));
  let last = 0;
  return async () => {
    const wait = last + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
}

export function geminiWriter(opts: GeminiOptions): Writer {
  const model = opts.model ?? DEFAULT_MODEL;
  const pace = spacer(opts.ratePerMinute ?? 8);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  /** One request. Throws on anything the caller should know about. */
  async function attempt(prompt: string): Promise<{ busy: true; waitMs: number } | { busy: false; text: string }> {
    await pace();

    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': opts.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Some spread, or every preview opens the same way across a slate.
          temperature: 1.0,
          // Generous, because on the 3.x models this budget is shared with the
          // model's own hidden reasoning. At 400 the reasoning consumed it and
          // what came back was a stub, which the validator correctly called
          // too-short -- and which looked like a writing problem rather than a
          // budget one. A paragraph needs about 200 tokens; the rest is
          // headroom for thinking.
          maxOutputTokens: 4096,
        },
        // The subject is football, and the default filters occasionally trip
        // on ordinary match language -- "thrashing", "killed off", "sudden
        // death". A block here costs a preview and gains nothing.
        safetySettings: [
          'HARM_CATEGORY_HARASSMENT',
          'HARM_CATEGORY_HATE_SPEECH',
          'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          'HARM_CATEGORY_DANGEROUS_CONTENT',
        ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    /*
     * 429 is two different things on the free tier, and only one of them is
     * the end of the day. Google says which in the body: a quota id naming a
     * per-day limit, and a RetryInfo delay. A per-minute limit clears in
     * seconds and is worth waiting out; treating it as final is what stopped
     * the writer a minute into every run and left the site on the grammar.
     */
    if (res.status === 429) {
      const body = await res.text();
      const daily = /per\s*day|PerDay|daily/i.test(body);
      const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
      const delay = m ? Number(m[1]) : Number(res.headers.get('retry-after')) || 30;
      // Which limit Google named, in its own ids (never anything of ours).
      const named = [...body.matchAll(/"quotaId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).join(', ');
      const value = body.match(/"quotaValue"\s*:\s*"([^"]+)"/)?.[1];
      if (daily || delay > 90) {
        throw new QuotaExhausted(`gemini free-tier ${daily ? 'daily' : 'long'} limit reached${named ? ` (${named}${value ? ` = ${value}` : ''})` : ''}`);
      }
      return { busy: true, waitMs: Math.ceil(delay * 1000) + 1000 };
    }

    // 503 is the free tier being busy rather than anything being wrong -- their
    // own message says spikes in demand are usually temporary. Worth waiting
    // out, unlike every other failure, which falls back to the grammar.
    if (res.status === 503) return { busy: true, waitMs: 3000 };

    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const body = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };

    const candidate = body.candidates?.[0];
    // A safety block returns 200 with no parts, which would otherwise surface
    // as an empty string and be rejected as too short with no explanation.
    if (!candidate || candidate.finishReason === 'SAFETY') {
      throw new Error(`gemini returned no usable candidate (${candidate?.finishReason ?? 'empty'})`);
    }

    const text = (candidate.content?.parts ?? []).map((part) => part.text ?? '').join('').trim();
    // An empty body with MAX_TOKENS means the whole budget went on reasoning.
    // Say which it was: "empty completion" sent the first investigation looking
    // at the prompt, where there was nothing to find.
    if (!text) {
      throw new Error(
        candidate.finishReason === 'MAX_TOKENS'
          ? 'gemini spent its whole token budget before writing anything'
          : `gemini returned an empty completion (${candidate.finishReason ?? 'no reason given'})`,
      );
    }
    return { busy: false, text };
  }

  return {
    name: `gemini:${model}`,
    async generate(prompt: string): Promise<string> {
      for (let tries = 0; tries <= RETRY_ON_BUSY; tries++) {
        const out = await attempt(prompt);
        if (!out.busy) return out.text;
        if (tries < RETRY_ON_BUSY) await new Promise((r) => setTimeout(r, out.waitMs * (tries + 1)));
      }
      throw new Error('gemini is busy — the model did not answer after three tries');
    },
  };
}
