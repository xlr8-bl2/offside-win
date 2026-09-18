/**
 * Gemini, on the free tier.
 *
 * Chosen because it costs nothing and the numbers fit with an order of
 * magnitude to spare: we write roughly 120 fixtures a day against a free
 * allowance of about 1,500 requests a day at 15 a minute. Paced at the limit
 * that is eight minutes of wall clock inside a workflow allowed two hours.
 *
 * Two consequences of the free tier shape the code rather than just the choice:
 *
 *   Batch mode is paid-tier only, so this is paced sequential requests and not
 *   a submit-and-poll. The limiter below is the same shape as the one in
 *   bsd.ts — a slot that is released while waiting rather than held.
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

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /** Requests per minute. The free tier allows 15 on Flash. */
  ratePerMinute?: number;
  timeoutMs?: number;
}

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
  const model = opts.model ?? 'gemini-2.5-flash';
  const pace = spacer(opts.ratePerMinute ?? 15);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return {
    name: `gemini:${model}`,
    async generate(prompt: string): Promise<string> {
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
            maxOutputTokens: 400,
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

      if (res.status === 429) {
        throw new QuotaExhausted('gemini free-tier quota exhausted');
      }
      if (!res.ok) {
        throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }

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

      const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
      if (!text) throw new Error('gemini returned an empty completion');
      return text;
    },
  };
}
