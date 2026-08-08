import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

import type { AnswerRecord, ApplicationRow, ParseCacheRecord, Profile, ResumeRecord } from '@/shared/types';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(TESTS_DIR, '..', 'fixtures');

export const FIXTURES = {
  greenhouse: 'greenhouse/standard.html',
  lever: 'lever/standard.html',
  workday: 'workday/step1-my-information.html',
  ashby: 'ashby/standard.html',
  generic: 'generic/plain-career-form.html',
} as const;

export type FixtureId = keyof typeof FIXTURES;

export const FIXTURE_URLS: Readonly<Record<FixtureId, string>> = {
  greenhouse: 'https://boards.greenhouse.io/northwindlabs/jobs/4210001',
  lever: 'https://jobs.lever.co/fablewright/00000000-0000-4000-8000-000000000001/apply',
  workday:
    'https://grimsby.wd5.myworkdayjobs.com/en-US/GrimsbyCareers/job/Data-Engineer-II/apply/applyManually',
  ashby: 'https://jobs.ashbyhq.com/halcyon-metrics/00000000-0000-4000-8000-000000000002/application',
  generic: 'https://careers.ravensmoor.example/jobs/technical-writer/apply',
};

export function readFixture(id: FixtureId): string {
  return readFileSync(join(FIXTURES_DIR, FIXTURES[id]), 'utf8');
}

export function loadFixture(id: FixtureId): Document {
  const html = readFixture(id);
  document.open();
  document.write(html);
  document.close();
  return document;
}

export function unloadFixture(): void {
  document.open();
  document.write('<!doctype html><html><head></head><body></body></html>');
  document.close();
}

export function ensureWebCrypto(): Crypto {
  const existing = globalThis.crypto as Crypto | undefined;
  if (existing?.subtle !== undefined) return existing;
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto as unknown as Crypto,
    configurable: true,
    writable: true,
  });
  return globalThis.crypto;
}

type StorageArea = Record<string, unknown>;

export interface MockAlarm {
  name: string;
  periodInMinutes?: number;
  when?: number;
  delayInMinutes?: number;
}

export interface MockRuntimeMessage {
  message: unknown;
  sender: { id: string; tab?: { id: number } };
}

export interface BrowserMock {
  storage: {
    local: {
      get(keys?: string | string[] | null): Promise<StorageArea>;
      set(items: StorageArea): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    };
    session: {
      get(keys?: string | string[] | null): Promise<StorageArea>;
      set(items: StorageArea): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    };
    onChanged: {
      addListener(fn: (changes: Record<string, unknown>, area: string) => void): void;
      removeListener(fn: (changes: Record<string, unknown>, area: string) => void): void;
      hasListener(fn: (changes: Record<string, unknown>, area: string) => void): boolean;
    };
  };
  runtime: {
    id: string;
    lastError: { message: string } | undefined;
    getURL(path: string): string;
    getManifest(): { version: string; name: string };
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(fn: (...args: unknown[]) => unknown): void;
      removeListener(fn: (...args: unknown[]) => unknown): void;
      hasListener(fn: (...args: unknown[]) => unknown): boolean;
    };
    onMessageExternal: {
      addListener(fn: (...args: unknown[]) => unknown): void;
      removeListener(fn: (...args: unknown[]) => unknown): void;
      hasListener(fn: (...args: unknown[]) => unknown): boolean;
    };
  };
  alarms: {
    create(name: string, info: Omit<MockAlarm, 'name'>): void;
    clear(name: string): Promise<boolean>;
    clearAll(): Promise<boolean>;
    getAll(): Promise<MockAlarm[]>;
    onAlarm: {
      addListener(fn: (alarm: MockAlarm) => void): void;
      removeListener(fn: (alarm: MockAlarm) => void): void;
      hasListener(fn: (alarm: MockAlarm) => void): boolean;
    };
  };
  __store: StorageArea;
  __alarms: Map<string, MockAlarm>;
  __sent: unknown[];
  __reset(): void;
  __emitMessage(message: unknown, sender?: MockRuntimeMessage['sender']): unknown[];
  __emitExternalMessage(message: unknown, sender: Record<string, unknown>): Promise<unknown>;
  __fireAlarm(name: string): void;
}

function listenerSet<F>(): {
  addListener(fn: F): void;
  removeListener(fn: F): void;
  hasListener(fn: F): boolean;
  all(): F[];
  clear(): void;
} {
  const listeners = new Set<F>();
  return {
    addListener: (fn: F) => void listeners.add(fn),
    removeListener: (fn: F) => void listeners.delete(fn),
    hasListener: (fn: F) => listeners.has(fn),
    all: () => [...listeners],
    clear: () => listeners.clear(),
  };
}

function createBrowserMock(): BrowserMock {
  const store: StorageArea = {};
  const sessionStore: StorageArea = {};
  const alarms = new Map<string, MockAlarm>();
  const sent: unknown[] = [];

  const storageChanged = listenerSet<(changes: Record<string, unknown>, area: string) => void>();
  const onMessage = listenerSet<(...args: unknown[]) => unknown>();
  const onMessageExternal = listenerSet<(...args: unknown[]) => unknown>();
  const onAlarm = listenerSet<(alarm: MockAlarm) => void>();

  const notify = (changes: Record<string, unknown>): void => {
    for (const fn of storageChanged.all()) fn(changes, 'local');
  };

  const mock: BrowserMock = {
    storage: {
      local: {
        async get(keys?: string | string[] | null): Promise<StorageArea> {
          if (keys === undefined || keys === null) return { ...store };
          const wanted = typeof keys === 'string' ? [keys] : keys;
          const out: StorageArea = {};
          for (const key of wanted) {
            if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
          }
          return out;
        },
        async set(items: StorageArea): Promise<void> {
          const changes: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          notify(changes);
        },
        async remove(keys: string | string[]): Promise<void> {
          const wanted = typeof keys === 'string' ? [keys] : keys;
          const changes: Record<string, unknown> = {};
          for (const key of wanted) {
            changes[key] = { oldValue: store[key], newValue: undefined };
            delete store[key];
          }
          notify(changes);
        },
        async clear(): Promise<void> {
          for (const key of Object.keys(store)) delete store[key];
          notify({});
        },
      },
      session: {
        async get(keys?: string | string[] | null): Promise<StorageArea> {
          if (keys === undefined || keys === null) return { ...sessionStore };
          const wanted = typeof keys === 'string' ? [keys] : keys;
          const out: StorageArea = {};
          for (const key of wanted) {
            if (Object.prototype.hasOwnProperty.call(sessionStore, key)) out[key] = sessionStore[key];
          }
          return out;
        },
        async set(items: StorageArea): Promise<void> {
          for (const [key, value] of Object.entries(items)) sessionStore[key] = value;
        },
        async remove(keys: string | string[]): Promise<void> {
          const wanted = typeof keys === 'string' ? [keys] : keys;
          for (const key of wanted) delete sessionStore[key];
        },
        async clear(): Promise<void> {
          for (const key of Object.keys(sessionStore)) delete sessionStore[key];
        },
      },
      onChanged: {
        addListener: storageChanged.addListener,
        removeListener: storageChanged.removeListener,
        hasListener: storageChanged.hasListener,
      },
    },

    runtime: {
      id: 'jobfill-test',
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://jobfill-test/${path.replace(/^\//, '')}`,
      getManifest: () => ({ version: '1.0.0', name: 'NextMove Autofill' }),
      async sendMessage(message: unknown): Promise<unknown> {
        sent.push(message);
        for (const fn of onMessage.all()) {
          const reply = fn(message, { id: 'jobfill-test' }, () => undefined);
          if (reply !== undefined) return reply;
        }
        return undefined;
      },
      onMessage: {
        addListener: onMessage.addListener,
        removeListener: onMessage.removeListener,
        hasListener: onMessage.hasListener,
      },
      onMessageExternal: {
        addListener: onMessageExternal.addListener,
        removeListener: onMessageExternal.removeListener,
        hasListener: onMessageExternal.hasListener,
      },
    },

    alarms: {
      create(name: string, info: Omit<MockAlarm, 'name'>): void {
        alarms.set(name, { name, ...info });
      },
      async clear(name: string): Promise<boolean> {
        return alarms.delete(name);
      },
      async clearAll(): Promise<boolean> {
        const had = alarms.size > 0;
        alarms.clear();
        return had;
      },
      async getAll(): Promise<MockAlarm[]> {
        return [...alarms.values()];
      },
      onAlarm: {
        addListener: onAlarm.addListener,
        removeListener: onAlarm.removeListener,
        hasListener: onAlarm.hasListener,
      },
    },

    __store: store,
    __alarms: alarms,
    __sent: sent,

    __reset(): void {
      for (const key of Object.keys(store)) delete store[key];
      for (const key of Object.keys(sessionStore)) delete sessionStore[key];
      // Listeners are per-worker state and must not survive a reset: a listener left registered by
      // an earlier test changes how the next one dispatches, which is the same class of bug as the
      // duplicate external listener this file's sibling test exists to catch.
      onMessage.clear();
      onMessageExternal.clear();
      onAlarm.clear();
      storageChanged.clear();
      alarms.clear();
      sent.length = 0;
      storageChanged.clear();
      onMessage.clear();
      onAlarm.clear();
      mock.runtime.lastError = undefined;
    },

    async __emitExternalMessage(message: unknown, sender: Record<string, unknown>): Promise<unknown> {
      // Chrome hands the message to every registered listener in registration order and delivers
      // the FIRST sendResponse it receives. Modelling that ordering is the whole point: a listener
      // registered earlier can silently swallow a later one's reply, which is exactly how the
      // connect handshake shipped broken.
      return new Promise((resolve) => {
        let settled = false;
        const respond = (reply: unknown): void => {
          if (settled) return;
          settled = true;
          resolve(reply);
        };
        for (const fn of onMessageExternal.all()) fn(message, sender, respond);
        if (!settled) queueMicrotask(() => setTimeout(() => respond(undefined), 0));
      });
    },

    __emitMessage(message: unknown, sender = { id: 'jobfill-test' }): unknown[] {
      return onMessage.all().map((fn) => fn(message, sender, () => undefined));
    },

    __fireAlarm(name: string): void {
      const alarm = alarms.get(name);
      if (alarm === undefined) return;
      for (const fn of onAlarm.all()) fn(alarm);
    },
  };

  return mock;
}

let installed: BrowserMock | null = null;

export function installBrowserMock(): BrowserMock {
  if (installed !== null) return installed;
  const mock = createBrowserMock();
  for (const name of ['browser', 'chrome'] as const) {
    Object.defineProperty(globalThis, name, { value: mock, configurable: true, writable: true });
  }
  installed = mock;
  return mock;
}

export function resetBrowserMock(): BrowserMock {
  const mock = installBrowserMock();
  mock.__reset();
  return mock;
}

export interface MemoryTable<T> {
  get(key: string): Promise<T | undefined>;
  put(row: T): Promise<string>;
  bulkPut(rows: readonly T[]): Promise<string>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  toArray(): Promise<T[]>;
  __seed(rows: readonly T[]): void;
  __rows(): T[];
}

function createMemoryTable<T extends Record<string, unknown>>(primaryKey: keyof T & string): MemoryTable<T> {
  const rows = new Map<string, T>();
  const keyOf = (row: T): string => String(row[primaryKey]);

  return {
    async get(key: string): Promise<T | undefined> {
      const row = rows.get(key);
      return row === undefined ? undefined : ({ ...row } as T);
    },
    async put(row: T): Promise<string> {
      const key = keyOf(row);
      rows.set(key, { ...row });
      return key;
    },
    async bulkPut(incoming: readonly T[]): Promise<string> {
      let last = '';
      for (const row of incoming) {
        last = keyOf(row);
        rows.set(last, { ...row });
      }
      return last;
    },
    async delete(key: string): Promise<void> {
      rows.delete(key);
    },
    async clear(): Promise<void> {
      rows.clear();
    },
    async count(): Promise<number> {
      return rows.size;
    },
    async toArray(): Promise<T[]> {
      return [...rows.values()].map((row) => ({ ...row }) as T);
    },
    __seed(incoming: readonly T[]): void {
      for (const row of incoming) rows.set(keyOf(row), { ...row });
    },
    __rows(): T[] {
      return [...rows.values()].map((row) => ({ ...row }) as T);
    },
  };
}

export interface MemoryDb {
  resumes: MemoryTable<ResumeRecord & Record<string, unknown>>;
  applications: MemoryTable<ApplicationRow & Record<string, unknown>>;
  parseCache: MemoryTable<ParseCacheRecord & Record<string, unknown>>;
  answerBank: MemoryTable<AnswerRecord & Record<string, unknown>>;
  isOpen(): boolean;
  open(): Promise<MemoryDb>;
  transaction(...args: unknown[]): Promise<unknown>;
}

export const memoryDb: MemoryDb = {
  resumes: createMemoryTable<ResumeRecord & Record<string, unknown>>('id'),
  applications: createMemoryTable<ApplicationRow & Record<string, unknown>>('id'),
  parseCache: createMemoryTable<ParseCacheRecord & Record<string, unknown>>('resumeId'),
  answerBank: createMemoryTable<AnswerRecord & Record<string, unknown>>('id'),
  isOpen: () => true,
  open: async () => memoryDb,
  async transaction(...args: unknown[]): Promise<unknown> {
    const body = args[args.length - 1];
    return typeof body === 'function' ? (body as () => unknown)() : undefined;
  },
};

export async function resetMemoryDb(): Promise<void> {
  await Promise.all([
    memoryDb.resumes.clear(),
    memoryDb.applications.clear(),
    memoryDb.parseCache.clear(),
    memoryDb.answerBank.clear(),
  ]);
}

export const HAS_INDEXEDDB: boolean =
  typeof globalThis === 'object' &&
  'indexedDB' in globalThis &&
  (globalThis as { indexedDB?: unknown }).indexedDB !== undefined;

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const base: Profile = {
    id: 'prof_test_0001',
    label: 'Default',
    isDefault: true,
    summary: 'Backend engineer with six years building payment and identity systems.',
    personal: {
      firstName: 'Asha',
      lastName: 'Varma',
      email: 'asha.varma@example.invalid',
      phone: '+91 90000 00000',
      address: {
        line1: '221B Rosewood Street',
        line2: 'Apartment 4',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        country: 'IN',
      },
    },
    links: {
      linkedin: 'https://www.linkedin.com/in/asha-varma-example',
      github: 'https://github.com/asha-varma-example',
      portfolio: 'https://asha.example.invalid',
      other: ['https://example.invalid/talks'],
    },
    work: [
      {
        title: 'Senior Software Engineer',
        company: 'Peregrine Systems',
        location: 'Bengaluru, India',
        start: '2022-03',
        end: null,
        current: true,
        bullets: [
          'Owned the payments ledger and cut reconciliation time by two thirds.',
          'Led the migration from a monolith to four service boundaries.',
        ],
      },
      {
        title: 'Software Engineer',
        company: 'Tidewater Analytics',
        location: 'Pune, India',
        start: '2019-07',
        end: '2022-02',
        current: false,
        bullets: ['Built the ingestion pipeline behind the reporting product.'],
      },
    ],
    education: [
      {
        school: 'Indian Institute of Technology, Kanpur',
        degree: 'B.Tech',
        field: 'Computer Science and Engineering',
        start: '2015-08',
        end: '2019-05',
        gpa: '8.6/10',
      },
    ],
    skills: ['TypeScript', 'Go', 'PostgreSQL', 'Kubernetes', 'Terraform'],
    authorization: {
      authorizedIn: ['IN'],
      needsSponsorship: { US: true, IN: false },
      visaStatus: 'Indian citizen',
      willingToRelocate: true,
      remotePreference: 'remote',
    },
    eeo: {
      gender: 'Female',
      ethnicity: 'Asian',
      veteran: 'I am not a protected veteran',
      disability: 'No, I do not have a disability',
      declineToState: false,
    },
    compensation: {
      expected: { amount: 4200000, currency: 'INR', period: 'year' },
      noticePeriodDays: 60,
    },
    answers: [
      {
        q: 'why do you want to work here',
        a: 'The problem space is one I have lived in for six years and the team writes publicly about how it works.',
        reusable: true,
      },
      {
        q: 'cover letter',
        a: 'I have spent six years building payment infrastructure and would like to keep doing exactly that, with people who care about correctness.',
        reusable: true,
      },
      {
        q: 'how did you hear about us',
        a: 'A former colleague sent me the posting.',
        reusable: true,
      },
      {
        q: 'additional information',
        a: 'Happy to share code samples and references on request.',
        reusable: true,
      },
    ],
    updatedAt: 1_767_225_600_000,
  };

  return { ...base, ...overrides };
}

export function makeEmptyProfile(): Profile {
  const profile = makeProfile();
  return {
    ...profile,
    personal: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' },
    },
    links: { linkedin: '', github: '', portfolio: '', other: [] },
    work: [],
    education: [],
    skills: [],
    answers: [],
  };
}
