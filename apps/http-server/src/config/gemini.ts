import { GPT_INSTRUCTION } from "@/utils/ai-chat-Instruction.js";
import { scrubSecrets } from "@/utils/redaction.js";
import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";
import logger from "./logger.js";
config();

/**
 * JF-001 SEC 15.1 / 15.5 — the Gemini client, refactored for **three lanes instead of one**.
 *
 * Before: the class hard-coded its clients from the `GEMINI_API_KEY_NAMES` env pool, so every web
 * generation spent the owner's quota. That is still exactly what happens for premium users — it is
 * lane 3, "managed", and nothing about it changes. What is new is that `generateMessage` now
 * accepts an **explicit key and model from the caller**, which is what lets `keyLane.service.ts`
 * hand it a free user's own vaulted key (lane 2) without this file knowing anything about vaults,
 * ciphertext or rotation.
 *
 * Source compatibility is a hard requirement: `chatControllers.ts` calls
 * `generateMessage(messageObj)` and `templateRepo.ts` calls `generateMessage(data, instruction)`.
 * Both still compile and behave identically — the new capability rides on an optional third
 * argument, and the default export is still the same singleton.
 *
 * This file never sees ciphertext and never decrypts anything. It receives a plaintext key as an
 * argument, uses it for one call, and drops it (SEC 15.8).
 */

/** The model the web features have always used. Callers may override per request. */
export const DEFAULT_WEB_MODEL = "gemini-2.5-flash";

/** Per-call overrides. Omit both and the call behaves exactly as it did before JF-001. */
export interface GenerateMessageOptions {
    /**
     * Plaintext Gemini API key to spend for this one call — a free user's vaulted key (lane 2).
     * Omitted ⇒ the managed env pool (lane 3). Never logged, never retained.
     */
    apiKey?: string;
    /** Model override, e.g. a fallback-chain model chosen by the rotation math. */
    model?: string;
}

class Gemini {

    /** Resolved plaintext keys from the server environment — the "managed" lane, owner-paid. */
    private managedKeys: string[];
    /** One cached SDK client per managed key. Bounded by the env pool, so it cannot grow. */
    private managedClients: GoogleGenAI[];
    private currentClientNumber: number;

    constructor() {
        this.managedKeys = Gemini.resolveManagedKeys();
        this.managedClients = this.managedKeys.map(apiKey => new GoogleGenAI({ apiKey }));
        this.currentClientNumber = 0;

        if (this.managedKeys.length === 0) {
            // Not fatal: a deployment running BYOK-only (SEC 15.7 rollout, flag flipped) has no
            // managed pool at all, and premium traffic is what would notice. Failing here would
            // take the whole API down for an AI-adjacent misconfiguration.
            logger.warn(
                "[CONFIG: gemini] No managed Gemini key configured (GEMINI_API_KEY / GEMINI_API_KEY_NAMES). " +
                "Premium generations and the BYOK grandfather fallback will fail until one is set."
            );
        }
    }

    /**
     * Read the managed pool out of the environment, tolerating every historical shape:
     *   · `GEMINI_API_KEY_NAMES` — a JSON array of *env var names* whose values hold the keys
     *     (the pattern this repo already ships with);
     *   · `GEMINI_API_KEY` — the single-key form SEC 15.5 refers to.
     *
     * A malformed `GEMINI_API_KEY_NAMES` is logged and skipped rather than thrown: the previous
     * implementation crashed the process at import time on a bad value, which meant one typo took
     * the entire API offline.
     */
    private static resolveManagedKeys(): string[] {
        const keys: string[] = [];

        const namesRaw = process.env.GEMINI_API_KEY_NAMES;
        if (namesRaw !== undefined && namesRaw.trim().length > 0) {
            try {
                const parsed: unknown = JSON.parse(namesRaw);
                if (Array.isArray(parsed)) {
                    for (const entry of parsed) {
                        if (typeof entry !== "string") continue;
                        const value = process.env[entry];
                        if (typeof value === "string" && value.trim().length > 0) keys.push(value.trim());
                    }
                } else {
                    logger.warn("[CONFIG: gemini] GEMINI_API_KEY_NAMES is not a JSON array — ignoring it.");
                }
            } catch (error) {
                logger.warn(`[CONFIG: gemini] GEMINI_API_KEY_NAMES is not valid JSON — ignoring it: ${error}`);
            }
        }

        const single = process.env.GEMINI_API_KEY;
        if (typeof single === "string" && single.trim().length > 0) keys.push(single.trim());

        // De-duplicate so the same key listed twice does not get twice the LRU weight.
        return [...new Set(keys)];
    }

    /** How many managed keys the environment supplied. `0` ⇒ the managed lane is unavailable. */
    get managedKeyCount(): number {
        return this.managedKeys.length;
    }

    /** `true` when the managed (owner-paid) lane can serve a request. */
    hasManagedKey(): boolean {
        return this.managedKeys.length > 0;
    }

    /**
     * The next managed key, round-robin — the same even-wear rotation the class has always done
     * across its clients, exposed so `keyLane.service.ts` can describe lane 3 without reimplementing
     * key selection or reaching into `process.env` itself.
     */
    nextManagedKey(): string {
        if (this.managedKeys.length === 0) {
            throw new Error(
                "No managed Gemini API key is configured. Set GEMINI_API_KEY, or GEMINI_API_KEY_NAMES to a JSON array of env var names."
            );
        }

        const index = this.currentClientNumber % this.managedKeys.length;
        const key = this.managedKeys[index];
        this.currentClientNumber = (this.currentClientNumber + 1) % this.managedKeys.length;

        // `noUncheckedIndexedAccess`: index is provably in range, but the guard is free.
        if (key === undefined) {
            throw new Error("Managed Gemini key pool is in an inconsistent state.");
        }
        return key;
    }

    /**
     * Resolve the SDK client for this call. An explicit key gets a fresh, uncached client — caching
     * per user key would mean holding user key material in a process-lifetime map, which is exactly
     * what "request-scoped plaintext" forbids (SEC 15.8).
     */
    private clientFor(apiKey: string | undefined): GoogleGenAI {
        if (apiKey !== undefined && apiKey.trim().length > 0) {
            return new GoogleGenAI({ apiKey: apiKey.trim() });
        }

        if (this.managedClients.length === 0) {
            throw new Error(
                "No managed Gemini API key is configured. Set GEMINI_API_KEY, or GEMINI_API_KEY_NAMES to a JSON array of env var names."
            );
        }

        const index = this.currentClientNumber % this.managedClients.length;
        const client = this.managedClients[index];
        this.currentClientNumber = (this.currentClientNumber + 1) % this.managedClients.length;

        if (client === undefined) {
            throw new Error("Managed Gemini client pool is in an inconsistent state.");
        }
        return client;
    }

    /**
     * Generate a message.
     *
     * @param messageObj      Prompt payload, serialised to JSON as the request contents (unchanged).
     * @param gpt_template    System instruction. Defaults to the chat instruction (unchanged).
     * @param options         **New, optional.** `apiKey` spends a caller-supplied key instead of the
     *                        managed pool; `model` overrides the default model. Omitting `options`
     *                        reproduces the pre-JF-001 behaviour exactly, which is why the existing
     *                        call sites in `chatControllers.ts` and `templateRepo.ts` are untouched.
     */
    async generateMessage(messageObj: {
        isNewRoom: boolean,
        message: string,
        previousMessages: string[],
        predefinedMessages: string[],
    } | { [key: string]: unknown }, gpt_template: string = GPT_INSTRUCTION, options: GenerateMessageOptions = {}) {
        try {
            const client = this.clientFor(options.apiKey);
            const response = await client.models.generateContent({
                    model: options.model ?? DEFAULT_WEB_MODEL,
                    contents: JSON.stringify(messageObj),
                    config:{
                        // responseJsonSchema: true,
                        systemInstruction: gpt_template
                    }

                });

            return response.text || null;
        } catch (error) {
            // Scrubbed: SDK errors can echo the key back in the request context they attach.
            logger.error(`[CONFIG: generateMessage] Error generating AI message`, scrubSecrets(error))
            throw error;
        }
    }
}

export { Gemini };
export default new Gemini();
