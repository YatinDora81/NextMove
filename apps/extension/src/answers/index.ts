/**
 * answers/index.ts — barrel for the Answer Bank (JF-001 Rev 3.0 SEC 5.7, F-17).
 *
 *   ./normalize   step 1 — the `{company}`-tokenised matching key, plus the templatize/rehydrate
 *                 pair that keeps an answer written for Acme out of a Globex form.
 *   ./bank        steps 2–4 — match (Jaccard + Jaro-Winkler tiebreak, SAME_Q / SIMILAR_Q), offer,
 *                 and upsert-with-provenance over the Dexie `answerBank` table.
 *
 * ── INV-2 / SEC 5.7 ──────────────────────────────────────────────────────────────────────────────
 * `answerBank.lookup()` is a fully OFFLINE read: no user-gesture nonce, no key lease, no network.
 * It runs BEFORE any key is leased, and `ANSWERS_LOOKUP` is deliberately absent from
 * `GESTURE_REQUIRED` in `shared/messages.ts`. Only "Regenerate with AI" enters the Gemini path.
 *
 * ── SEC 7.4 ──────────────────────────────────────────────────────────────────────────────────────
 * The bank is local-only and is NEVER synced. It IS part of the user's own profile export/import:
 * `answerBank.exportAnswerBank()` / `answerBank.importAnswerBank()` are what the Options
 * "export everything" and "import" screens must include alongside the profile vault.
 */

export * as answerBank from './bank';
export * as answerText from './normalize';

export * from './normalize';
export * from './bank';
