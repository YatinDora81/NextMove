/**
 * platform/logger.ts — the only console this extension talks through (JF-001 Rev 3.0 SEC 9.2).
 *
 * INV-5 (extension-vault keys never leave the device): a Gemini API key must never reach a
 * console, a crash report, or a DevTools transcript. Every argument handed to this module is
 * walked and redacted before it is printed:
 *
 *   - anything matching /AIza[0-9A-Za-z_-]{10,}/g becomes `AIza…REDACTED`
 *     (the `KEYS_ADD` bus payload carries a plaintext key in `payload.key`, and the bus logs
 *      envelopes at debug level — so this pass is the thing that actually saves us);
 *   - properties whose *name* marks them as secret-bearing (`apiKey`, `passphrase`, `secret`,
 *     `gesture`, `ct`, `authorization`, …) are replaced wholesale, regardless of their value.
 *
 * This is defence in depth, not a licence to log secrets: no caller should hand a plaintext key
 * to the logger in the first place. There is no "unredacted" escape hatch, deliberately.
 *
 * Zero dependencies — this is the lowest module in the platform stack, so every other module
 * (bus, storage, db, crypto, gesture) can log without creating an import cycle.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

/** SEC 5.3 mask style — Google AI Studio keys are `AIza…` prefixed. INV-5. */
export const GEMINI_KEY_PATTERN = /AIza[0-9A-Za-z_-]{10,}/g;
export const GEMINI_KEY_MASK = 'AIza…REDACTED';

/** Replacement for a value that was redacted by property name rather than by pattern. */
export const REDACTED = '[redacted]';

/**
 * Property names that may never be printed, whatever they hold. `key` is deliberately NOT in
 * this list — it is far too common a field name ("storage key", "keyId") and the `AIza…` pattern
 * pass already catches the one payload that matters (`KEYS_ADD.payload.key`).
 */
const SECRET_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'apikey',
  'api_key',
  'x-goog-api-key',
  'plaintext',
  'passphrase',
  'password',
  'secret',
  'installsecret',
  'vaultsecret',
  'gesture',
  'jwt',
  'authorization',
  'ct',
  'ciphertext',
  'tokenct',
  'devicetoken',
]);

/** Depth cap so a cyclic-free but pathologically deep object cannot stall the console. */
const MAX_DEPTH = 6;
/** Arrays longer than this are truncated with a `…(+N more)` marker. */
const MAX_ARRAY_ITEMS = 50;

/* ------------------------------------------------------------------------------------------------
 * Redaction
 * ---------------------------------------------------------------------------------------------- */

/** Mask every Gemini-shaped substring. Safe to call on any string, including whole JSON blobs. */
export function redactString(input: string): string {
  return input.replace(GEMINI_KEY_PATTERN, GEMINI_KEY_MASK);
}

function isSecretProperty(name: string): boolean {
  return SECRET_PROPERTY_NAMES.has(name.toLowerCase());
}

function describeOpaque(value: object): string | null {
  if (value instanceof Date) return null;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `[Blob ${value.size}B ${value.type}]`;
  if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength}B]`;
  if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${value.byteLength}B]`;
  if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) return '[CryptoKey]';
  return null;
}

function redactError(error: Error): Record<string, unknown> {
  return {
    name: redactString(error.name),
    message: redactString(error.message),
    stack: typeof error.stack === 'string' ? redactString(error.stack) : undefined,
  };
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (value === null || typeof value !== 'object') return value;

  const object = value as object;
  if (seen.has(object)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  const opaque = describeOpaque(object);
  if (opaque !== null) return opaque;
  if (object instanceof Date) return object.toISOString();
  if (object instanceof Error) return redactError(object);

  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const out: unknown[] = [];
      const limit = Math.min(object.length, MAX_ARRAY_ITEMS);
      for (let i = 0; i < limit; i += 1) out.push(redactValue(object[i], depth + 1, seen));
      if (object.length > limit) out.push(`…(+${object.length - limit} more)`);
      return out;
    }

    if (object instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [rawKey, rawValue] of object.entries()) {
        const name = typeof rawKey === 'string' ? rawKey : String(rawKey);
        out[redactString(name)] = isSecretProperty(name)
          ? REDACTED
          : redactValue(rawValue, depth + 1, seen);
      }
      return out;
    }

    if (object instanceof Set) {
      const out: unknown[] = [];
      for (const item of object.values()) out.push(redactValue(item, depth + 1, seen));
      return out;
    }

    const out: Record<string, unknown> = {};
    for (const [name, rawValue] of Object.entries(object as Record<string, unknown>)) {
      out[name] = isSecretProperty(name) ? REDACTED : redactValue(rawValue, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(object);
  }
}

/**
 * Deep-redact an arbitrary value: strings are pattern-masked, secret-named properties are
 * dropped, cycles and huge structures are bounded. Exported so callers that build their own
 * telemetry-free diagnostics (options "copy debug info") reuse exactly this policy.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet<object>());
}

/* ------------------------------------------------------------------------------------------------
 * Level control
 * ---------------------------------------------------------------------------------------------- */

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === 'debug' || value === 'info' || value === 'warn' || value === 'error' || value === 'silent'
  );
}

const globalOverride = (globalThis as { __JF_LOG_LEVEL__?: unknown }).__JF_LOG_LEVEL__;
let currentLevel: LogLevel = isLogLevel(globalOverride) ? globalOverride : 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

/* ------------------------------------------------------------------------------------------------
 * Logger
 * ---------------------------------------------------------------------------------------------- */

export interface Logger {
  readonly scope: string;
  debug(message: string, ...args: readonly unknown[]): void;
  info(message: string, ...args: readonly unknown[]): void;
  warn(message: string, ...args: readonly unknown[]): void;
  error(message: string, ...args: readonly unknown[]): void;
  /** Nested scope: `createLogger('bus').child('router')` prints `[jf:bus:router]`. */
  child(scope: string): Logger;
}

type ConsoleMethod = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Exclude<LogLevel, 'silent'>, scope: string, message: string, args: readonly unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const prefix = `[${scope}]`;
  const safeMessage = redactString(message);
  const safeArgs = args.map((arg) => redact(arg));

  const method: ConsoleMethod = level;
  const sink = console[method] as ((...values: unknown[]) => void) | undefined;
  if (typeof sink === 'function') {
    sink(prefix, safeMessage, ...safeArgs);
    return;
  }
  console.log(prefix, safeMessage, ...safeArgs);
}

/** Create a scoped logger. Scopes are prefixed with `jf:` so extension output is greppable. */
export function createLogger(scope: string): Logger {
  const fullScope = scope.startsWith('jf') ? scope : `jf:${scope}`;
  return {
    scope: fullScope,
    debug: (message, ...args) => emit('debug', fullScope, message, args),
    info: (message, ...args) => emit('info', fullScope, message, args),
    warn: (message, ...args) => emit('warn', fullScope, message, args),
    error: (message, ...args) => emit('error', fullScope, message, args),
    child: (childScope) => createLogger(`${fullScope}:${childScope}`),
  };
}

/** Default logger for code that has no scope of its own. */
export const logger: Logger = createLogger('jf');
