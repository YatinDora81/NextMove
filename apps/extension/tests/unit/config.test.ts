/**
 * tests/unit/config.test.ts — JF-001 F-14 / SEC 8.3.
 *
 * The adapter config ships twice: `config/adapters.seed.json` is bundled into the extension, and
 * `apps/web/public/extension/adapters.json` is the CDN copy the ConfigSync alarm polls daily. The
 * whole point of F-14 is that the CDN file can be edited to hotfix an ATS DOM change without a
 * store re-review — which means a malformed edit would ship straight to every user. It is data,
 * not code (that is what keeps it MV3-legal), so the schema is the only thing standing between a
 * typo and a broken fill engine in the field. Both copies are therefore validated here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { remoteAdapterConfigSchema } from '@repo/types/ExtensionTypes';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FILES: Record<string, string> = {
  'shipped seed': join(ROOT, 'config', 'adapters.seed.json'),
  'CDN copy (apps/web/public)': join(ROOT, '..', 'web', 'public', 'extension', 'adapters.json'),
};

describe('F-14 · remote adapter config', () => {
  for (const [name, path] of Object.entries(FILES)) {
    it(`${name} validates against remoteAdapterConfigSchema`, () => {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const parsed = remoteAdapterConfigSchema.safeParse(raw);
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
    });

    it(`${name} covers every shipped adapter`, () => {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { adapters?: Record<string, unknown> };
      for (const id of ['greenhouse', 'lever', 'workday', 'icims', 'ashby', 'smartrecruiters', 'taleo']) {
        expect(Object.keys(raw.adapters ?? {}), `${name} is missing ${id}`).toContain(id);
      }
    });
  }

  it('model budgets are present and are treated as approximate soft ceilings', () => {
    const raw = JSON.parse(readFileSync(FILES['shipped seed']!, 'utf8')) as {
      modelBudgets?: Record<string, { rpm: number; rpd: number }>;
    };
    // SEC 5.2: Google revises free-tier limits without notice, so these live in config, not code.
    expect(raw.modelBudgets).toBeDefined();
    expect(Object.keys(raw.modelBudgets ?? {}).length).toBeGreaterThan(0);
  });
});
