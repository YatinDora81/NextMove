/**
 * tests/e2e/helpers/gemini.ts — "Gemini stubbed via request interception" (SEC 11, e2e row).
 *
 * Two hard rules this file exists to enforce:
 *
 *   1. **No test ever makes a real Gemini call.** The route is installed on the BrowserContext
 *      before the service worker has done anything, and it matches the whole host, so the
 *      validation ping (`GET /v1beta/models`, SEC 2.3) and every `:generateContent` POST are both
 *      fulfilled locally. Anything unrecognised on that host is failed loudly rather than passed
 *      through — a spec that starts calling a new Gemini endpoint should break, not quietly bill
 *      somebody.
 *
 *   2. **Every call is counted.** F-17's whole claim is that a banked answer costs nothing, so
 *      `generateCalls` is the instrument that proves it: the Answer-Memory half of
 *      `ai-answer.spec.ts` asserts the counter does not move.
 *
 * The remote adapter config (F-14, `CONFIG_URL` on nextmove-yatin.vercel.app) is stubbed too, with
 * a 503. That is not laziness — INV-3 says the extension must work fully with the backend switched
 * off, so every e2e run deliberately exercises the shipped-seed fallback path and never depends on
 * a CDN being up.
 */

import type { BrowserContext } from '@playwright/test';

export const GEMINI_HOST_GLOB = 'https://generativelanguage.googleapis.com/**';
export const CONFIG_HOST_GLOB = 'https://nextmove-yatin.vercel.app/**';

export interface GeminiStub {
  /** `:generateContent` POSTs served since the last `reset()`. */
  readonly generateCalls: number;
  /** `GET /v1beta/models` validation pings served since the last `reset()`. */
  readonly validateCalls: number;
  /** Models named in the requests seen so far, in order. */
  readonly modelsCalled: readonly string[];
  /** Replace the answer text the stub returns from here on. */
  setAnswer(text: string): void;
  /** Zero the counters — used to prove "no further calls" after a checkpoint. */
  reset(): void;
}

/**
 * A deliberately human-sounding default answer.
 *
 * `ai/humanize.ts` runs an AI-tell detector on every draft and issues exactly one automatic
 * rewrite when it trips (SEC 5.5) — which would be a second billed call and would make the
 * F-17 counter assertions ambiguous. Concrete, first-person, no "As an AI", no "I am excited to
 * leverage": this passes the detector, so one ✨ click is one request.
 */
const DEFAULT_ANSWER =
  'I spent four years on payment infrastructure, and the part I keep coming back to is the ' +
  'unglamorous reliability work that keeps money moving while nobody is watching. Your team owns ' +
  'that end to end rather than handing it to a platform group, which is the main reason I applied.';

interface Counters {
  generate: number;
  validate: number;
  models: string[];
  answer: string;
}

export async function installGeminiStub(context: BrowserContext): Promise<GeminiStub> {
  const counters: Counters = { generate: 0, validate: 0, models: [], answer: DEFAULT_ANSWER };

  await context.route(GEMINI_HOST_GLOB, async (route) => {
    const request = route.request();
    const url = request.url();

    // SEC 2.3: the key travels in the `x-goog-api-key` HEADER, never the query string. If that
    // ever regresses, the stub is the first place it shows up — so assert it here, once.
    if (url.includes('key=')) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: 'INV-5: the API key must travel in the x-goog-api-key header.' },
        }),
      });
      return;
    }

    if (url.includes(':generateContent')) {
      counters.generate += 1;
      const model = /\/models\/([^:]+):generateContent/.exec(url)?.[1] ?? 'unknown';
      counters.models.push(decodeURIComponent(model));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: counters.answer }] },
              finishReason: 'STOP',
              safetyRatings: [],
            },
          ],
          usageMetadata: {
            promptTokenCount: 412,
            candidatesTokenCount: 68,
            totalTokenCount: 480,
          },
          modelVersion: decodeURIComponent(model),
        }),
      });
      return;
    }

    if (request.method() === 'GET' && /\/v1beta\/models(\?|$)/.test(url)) {
      counters.validate += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          models: [
            {
              name: 'models/gemini-2.5-flash-lite',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          message:
            `The e2e Gemini stub does not know this endpoint: ${request.method()} ${url}. ` +
            'Teach helpers/gemini.ts about it rather than letting the suite reach Google.',
        },
      }),
    });
  });

  // INV-3 — the CDN is never a dependency of a test run.
  await context.route(CONFIG_HOST_GLOB, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'text/plain; charset=utf-8',
      body: 'remote adapter config is deliberately unavailable during e2e (INV-3)',
    });
  });

  return {
    get generateCalls() {
      return counters.generate;
    },
    get validateCalls() {
      return counters.validate;
    },
    get modelsCalled() {
      return counters.models;
    },
    setAnswer(text: string) {
      counters.answer = text;
    },
    reset() {
      counters.generate = 0;
      counters.validate = 0;
      counters.models = [];
    },
  };
}
