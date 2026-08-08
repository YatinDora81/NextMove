

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureWebCrypto, installBrowserMock, resetBrowserMock } from '../setup';

installBrowserMock();

import { profileSchema } from '@repo/types/ProfileTypes';

import { configureVaultPorts, addKey, listKeys } from '@/ai/vault';
import { getProfiles, getSettings } from '@/platform/storage';
import {
  API_BASE_URL,
  GEMINI_API_KEY_HEADER,
  GEMINI_API_ORIGIN,
  MODE_KEY,
  ONBOARDED_KEY,
  ONBOARDING_DRAFT_KEY,
  STORAGE_KEY_KEYS,
  VAULT_SECRET_KEY,
} from '@/shared/constants';
import {
  EMPTY_DRAFT,
  YEARS_OF_EXPERIENCE_QUESTION,
  profileFromWizard,
  readDraft,
  saveWizardProfile,
  splitFullName,
  splitLocation,
  splitSkills,
} from '@/entrypoints/onboarding/App';
import type { WizardDraft } from '@/entrypoints/onboarding/App';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const ONBOARDING_DIR = join(SRC_DIR, 'entrypoints', 'onboarding');

const FULL: WizardDraft = {
  fullName: 'Yatin Dora',
  phone: '+91 98000 00010',
  email: 'yatin@example.invalid',
  location: 'Bengaluru, IN',
  role: 'Frontend Developer',
  yearsExp: '5',
  skills: 'React, Node.js, PostgreSQL',
  linkedin: 'linkedin.com/in/yatindora',
  github: 'github.com/YatinDora81',
  portfolio: 'yatin.example.invalid',
};

const PLANTED_KEY = 'AIzaSyOnboardingTestKey_000000000000000';

beforeAll(() => {
  ensureWebCrypto();
});

beforeEach(() => {
  resetBrowserMock();
});

describe('splitFullName', () => {
  it('leaves both halves empty for an empty entry', () => {
    expect(splitFullName('')).toEqual({ firstName: '', lastName: '' });
    expect(splitFullName('   ')).toEqual({ firstName: '', lastName: '' });
  });

  it('treats a single word as a first name', () => {
    expect(splitFullName('Yatin')).toEqual({ firstName: 'Yatin', lastName: '' });
  });

  it('splits on the first space and keeps the rest as the surname', () => {
    expect(splitFullName('Yatin Dora')).toEqual({ firstName: 'Yatin', lastName: 'Dora' });
    expect(splitFullName('Yatin Kumar Dora')).toEqual({
      firstName: 'Yatin',
      lastName: 'Kumar Dora',
    });
  });

  it('tolerates padding and runs of whitespace', () => {
    expect(splitFullName('  Yatin   Dora  ')).toEqual({ firstName: 'Yatin', lastName: 'Dora' });
  });
});

describe('splitLocation', () => {
  it('reads one part as a city', () => {
    expect(splitLocation('Bengaluru')).toEqual({ city: 'Bengaluru', state: '', country: '' });
  });

  it('reads two parts as city and country', () => {
    expect(splitLocation('Bengaluru, IN')).toEqual({
      city: 'Bengaluru',
      state: '',
      country: 'IN',
    });
  });

  it('reads three parts as city, state and country', () => {
    expect(splitLocation('Bengaluru, Karnataka, IN')).toEqual({
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'IN',
    });
  });

  it('is empty for an empty entry', () => {
    expect(splitLocation('  ,  ')).toEqual({ city: '', state: '', country: '' });
  });
});

describe('splitSkills', () => {
  it('splits on commas and trims', () => {
    expect(splitSkills('React, Node.js , PostgreSQL')).toEqual([
      'React',
      'Node.js',
      'PostgreSQL',
    ]);
  });

  it('drops empty segments and case-insensitive duplicates', () => {
    expect(splitSkills('React,,react , REACT, Go')).toEqual(['React', 'Go']);
  });

  it('is empty for an empty entry', () => {
    expect(splitSkills('   ')).toEqual([]);
  });
});

describe('readDraft', () => {
  it('falls back to the empty draft for anything that is not an object', () => {
    expect(readDraft(null)).toEqual(EMPTY_DRAFT);
    expect(readDraft('nope')).toEqual(EMPTY_DRAFT);
    expect(readDraft(undefined)).toEqual(EMPTY_DRAFT);
  });

  it('keeps known string fields and ignores everything else', () => {
    const restored = readDraft({ fullName: 'Yatin Dora', phone: 42, injected: 'x' });
    expect(restored.fullName).toBe('Yatin Dora');
    expect(restored.phone).toBe('');
    expect(Object.keys(restored).sort()).toEqual(Object.keys(EMPTY_DRAFT).sort());
  });
});

describe('profileFromWizard', () => {
  it('maps every wizard field onto the nested profile shape', () => {
    const profile = profileFromWizard(FULL, 'prof_onboarding', 1_700_000_000_000);

    expect(profile.id).toBe('prof_onboarding');
    expect(profile.label).toBe('Default');
    expect(profile.isDefault).toBe(true);
    expect(profile.updatedAt).toBe(1_700_000_000_000);

    expect(profile.personal.firstName).toBe('Yatin');
    expect(profile.personal.lastName).toBe('Dora');
    expect(profile.personal.email).toBe('yatin@example.invalid');
    expect(profile.personal.phone).toBe('+91 98000 00010');
    expect(profile.personal.address.city).toBe('Bengaluru');
    expect(profile.personal.address.country).toBe('IN');

    expect(profile.links.linkedin).toBe('linkedin.com/in/yatindora');
    expect(profile.links.github).toBe('github.com/YatinDora81');
    expect(profile.links.portfolio).toBe('yatin.example.invalid');
    expect(profile.links.other).toEqual([]);

    expect(profile.skills).toEqual(['React', 'Node.js', 'PostgreSQL']);

    expect(profile.work).toHaveLength(1);
    expect(profile.work[0]?.title).toBe('Frontend Developer');
    expect(profile.work[0]?.current).toBe(true);
    expect(profile.work[0]?.location).toBe('Bengaluru, IN');

    expect(profile.answers).toEqual([
      { q: YEARS_OF_EXPERIENCE_QUESTION, a: '5', reusable: true },
    ]);
  });

  it('produces a schema-valid profile from a completely empty wizard', () => {
    const profile = profileFromWizard(EMPTY_DRAFT, 'prof_empty', 1);

    expect(profile.work).toEqual([]);
    expect(profile.answers).toEqual([]);
    expect(profile.skills).toEqual([]);
    expect(profile.personal.firstName).toBe('');
    expect(profileSchema.safeParse(profile).success).toBe(true);
  });

  it('produces a schema-valid profile from a full wizard', () => {
    const parsed = profileSchema.safeParse(profileFromWizard(FULL, 'prof_full', 2));
    expect(parsed.success).toBe(true);
  });

  it('trims every value it stores', () => {
    const padded: WizardDraft = {
      ...EMPTY_DRAFT,
      fullName: '  Yatin Dora ',
      email: '  yatin@example.invalid  ',
      phone: ' +91 ',
      role: '  Frontend Developer  ',
      yearsExp: ' 5 ',
      linkedin: '  linkedin.com/in/yatindora ',
    };
    const profile = profileFromWizard(padded, 'prof_pad', 3);

    expect(profile.personal.email).toBe('yatin@example.invalid');
    expect(profile.personal.phone).toBe('+91');
    expect(profile.work[0]?.title).toBe('Frontend Developer');
    expect(profile.answers[0]?.a).toBe('5');
    expect(profile.links.linkedin).toBe('linkedin.com/in/yatindora');
  });

  it('is pure — the same draft twice yields the same profile', () => {
    expect(profileFromWizard(FULL, 'same', 9)).toEqual(profileFromWizard(FULL, 'same', 9));
  });
});

describe('saveWizardProfile', () => {
  it('writes the profile through the sealed profiles slot and makes it active', async () => {
    const saved = await saveWizardProfile(FULL, 1_700_000_000_000);

    const profiles = await getProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.id).toBe(saved.id);
    expect(profiles[0]?.personal.firstName).toBe('Yatin');

    const settings = await getSettings();
    expect(settings.activeProfileId).toBe(saved.id);
  });

  it('never leaves the profile in plaintext on disk', async () => {
    await saveWizardProfile(FULL);
    const raw = JSON.stringify(
      (globalThis as unknown as { browser: ReturnType<typeof installBrowserMock> }).browser
        .__store,
    );
    expect(raw).not.toContain('yatin@example.invalid');
    expect(raw).not.toContain('Bengaluru');
  });
});

describe('the guest path never reaches the network', () => {
  it('completes the wizard with fetch untouched', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('the guest wizard must not make a network request');
    });
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const ext = (globalThis as unknown as { browser: ReturnType<typeof installBrowserMock> })
        .browser;

      await ext.storage.local.set({ [MODE_KEY]: 'guest' });
      await ext.storage.local.set({ [ONBOARDING_DRAFT_KEY]: FULL });
      await saveWizardProfile(FULL);
      await ext.storage.local.set({ [ONBOARDED_KEY]: true });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(ext.__store[MODE_KEY]).toBe('guest');
      expect(ext.__store[ONBOARDED_KEY]).toBe(true);
      expect(await getProfiles()).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('has no request-issuing code in the onboarding entrypoint at all', () => {
    for (const file of ['App.tsx', 'main.tsx']) {
      const source = readFileSync(join(ONBOARDING_DIR, file), 'utf8');
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/XMLHttpRequest/);
      expect(source).not.toMatch(/sendBeacon/);
      expect(source).not.toMatch(/new\s+WebSocket/);
      expect(source).not.toContain('API_BASE_URL');
    }
  });

  it('reaches the web app only by opening a tab the user asked for', () => {
    const source = readFileSync(join(ONBOARDING_DIR, 'App.tsx'), 'utf8');
    expect(source).toContain('browser.tabs.create({ url: authUrl(popup) })');
    expect(source).toContain("url.searchParams.set('redirect_url', WEB_AUTH_REDIRECT_PATH)");
  });
});

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

describe('the Gemini key never leaves this device', () => {
  const vaultStore = new Map<string, unknown>();
  let captured: CapturedRequest[] = [];

  beforeEach(() => {
    vaultStore.clear();
    captured = [];
    configureVaultPorts({
      storage: {
        read: async (key) => vaultStore.get(key) ?? null,
        write: async (key, value) => {
          vaultStore.set(key, value);
        },
        remove: async (key) => {
          vaultStore.delete(key);
        },
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        captured.push({ url: String(input), init });
        return { ok: true, status: 200 } as unknown as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    configureVaultPorts({ storage: null });
  });

  it('validates against Google only, and never against the NextMove API', async () => {
    const result = await addKey(PLANTED_KEY, 'Gemini key');
    expect(result.ok).toBe(true);

    expect(captured.length).toBeGreaterThan(0);
    for (const request of captured) {
      expect(request.url.startsWith(GEMINI_API_ORIGIN)).toBe(true);
      expect(request.url.startsWith(API_BASE_URL)).toBe(false);
    }
  });

  it('carries the key in a header — never in a URL and never in a body', async () => {
    await addKey(PLANTED_KEY, 'Gemini key');

    for (const request of captured) {
      expect(request.url).not.toContain(PLANTED_KEY);
      const body = request.init?.body;
      expect(body === undefined || body === null).toBe(true);
    }

    const headers = captured[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.[GEMINI_API_KEY_HEADER]).toBe(PLANTED_KEY);
  });

  it('seals the key before it touches storage, and masks it for the UI', async () => {
    await addKey(PLANTED_KEY, 'Gemini key');

    const persisted = JSON.stringify([...vaultStore.entries()]);
    expect(persisted).not.toContain(PLANTED_KEY);
    expect(vaultStore.has(STORAGE_KEY_KEYS)).toBe(true);
    expect(vaultStore.has(VAULT_SECRET_KEY)).toBe(true);

    const rows = vaultStore.get(STORAGE_KEY_KEYS) as { ct: string; iv: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ct.length).toBeGreaterThan(0);
    expect(rows[0]?.iv.length).toBeGreaterThan(0);

    const listed = await listKeys();
    expect(listed[0]?.masked).toBe('AIza…' + PLANTED_KEY.slice(-4));
    expect(JSON.stringify(listed)).not.toContain(PLANTED_KEY);
  });

  it('never writes the key into the extension storage the wizard uses for its draft', async () => {
    await addKey(PLANTED_KEY, 'Gemini key');
    const ext = (globalThis as unknown as { browser: ReturnType<typeof installBrowserMock> })
      .browser;
    expect(JSON.stringify(ext.__store)).not.toContain(PLANTED_KEY);
  });
});
