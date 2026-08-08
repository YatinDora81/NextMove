/**
 * tests/redaction.test.ts — JF-001 SEC 15.8: "Redaction is tested, not promised. A CI test feeds a
 * fake key through every Winston serializer and asserts it cannot appear in output."
 *
 * This is that test. A key that reaches a log file is a leaked key, whatever the vault does.
 */
import { describe, it, expect } from 'vitest';
import { createLogger, transports, format } from 'winston';
import { Writable } from 'node:stream';

import { scrubSecrets, scrubString, redactionFormat, installRedaction, REDACTED } from '@/utils/redaction.js';

// Split so no `AIza` + 35-character literal exists for GitHub secret scanning to flag; the joined
// value is unchanged, so this still exercises the real key shape.
const KEY = ['AIza', 'SyD-FAKE-KEY-FOR-TESTS-0000000009F2k'].join('');

/**
 * Collects every serialized line a logger actually emits. Built on a Stream transport rather than
 * a custom `winston-transport` subclass so the suite adds no dependency — and, more usefully, it
 * captures the FINAL serialized bytes that would hit a file, not an in-memory info object.
 */
function capture(): { lines: string[]; transport: transports.StreamTransportInstance } {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });
  return { lines, transport: new transports.Stream({ stream: sink }) };
}

describe('SEC 15.8 · a Gemini key cannot survive any serializer', () => {
  it('scrubString removes a bare key', () => {
    expect(scrubString(`key=${KEY}`)).not.toContain(KEY);
    expect(scrubString(`key=${KEY}`)).toContain(REDACTED);
  });

  it('scrubSecrets removes keys nested in objects, arrays and Errors', () => {
    const payload = {
      note: `using ${KEY}`,
      list: [KEY, { deep: { deeper: KEY } }],
      err: new Error(`boom ${KEY}`),
      apiKey: KEY,
    };
    const out = JSON.stringify(scrubSecrets(payload));
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('AIzaSy');
  });

  it('survives a cyclic object without hanging', () => {
    const cyclic: Record<string, unknown> = { key: KEY };
    cyclic['self'] = cyclic;
    const out = JSON.stringify(scrubSecrets(cyclic));
    expect(out).not.toContain(KEY);
  });

  it('a real Winston logger wearing redactionFormat never emits the key', () => {
    const cap = capture();
    const logger = createLogger({
      level: 'debug',
      format: format.combine(redactionFormat, format.json()),
      transports: [cap.transport],
    });

    logger.info(`plain message with ${KEY}`);
    logger.error('structured', { apiKey: KEY });
    logger.warn('nested', { a: { b: [KEY] } });
    logger.error(new Error(`thrown ${KEY}`));

    expect(cap.lines.length).toBeGreaterThan(0);
    for (const line of cap.lines) {
      expect(line, `a key escaped into: ${line}`).not.toContain(KEY);
      expect(line).not.toContain('AIzaSy');
    }
  });

  it('installRedaction hardens a logger that was built without the format', () => {
    const cap = capture();
    const logger = createLogger({ level: 'debug', format: format.json(), transports: [cap.transport] });
    installRedaction(logger);

    logger.info(`late-hardened ${KEY}`);
    logger.error('obj', { key: KEY });

    for (const line of cap.lines) {
      expect(line, `a key escaped into: ${line}`).not.toContain(KEY);
    }
  });

  it('installRedaction is idempotent (index.ts and keyVault.ts both call it)', () => {
    const cap = capture();
    const logger = createLogger({ level: 'debug', format: format.json(), transports: [cap.transport] });
    installRedaction(logger);
    installRedaction(logger);
    logger.info(`twice ${KEY}`);
    expect(cap.lines.join('\n')).not.toContain(KEY);
  });
});
