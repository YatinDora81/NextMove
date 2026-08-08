import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';

import { createEmptyProfile } from '@repo/types/ProfileTypes';

import { randomId } from '@/platform/crypto';
import { patchSettings, upsertProfile } from '@/platform/storage';
import {
  AI_STUDIO_KEY_URL,
  MODE_KEY,
  ONBOARDED_KEY,
  ONBOARDING_AUTOSAVE_MS,
  ONBOARDING_DRAFT_KEY,
  WEB_APP_URL,
  WEB_AUTH_REDIRECT_PATH,
} from '@/shared/constants';
import type { Profile } from '@/shared/types';
import { Button, Input, cx } from '@/ui/components';
import { Check, ExternalLink } from '@/ui/icons';
import { call, describeError } from '@/ui/store';

export type WizardStep = 'fork' | 'about' | 'experience' | 'links' | 'ai' | 'done';

export const WIZARD_ORDER: readonly WizardStep[] = [
  'fork',
  'about',
  'experience',
  'links',
  'ai',
  'done',
];

export interface WizardDraft {
  fullName: string;
  phone: string;
  email: string;
  location: string;
  role: string;
  yearsExp: string;
  skills: string;
  linkedin: string;
  github: string;
  portfolio: string;
}

export const EMPTY_DRAFT: WizardDraft = {
  fullName: '',
  phone: '',
  email: '',
  location: '',
  role: '',
  yearsExp: '',
  skills: '',
  linkedin: '',
  github: '',
  portfolio: '',
};

const DRAFT_FIELDS: readonly (keyof WizardDraft)[] = Object.keys(EMPTY_DRAFT) as (keyof WizardDraft)[];

export function readDraft(raw: unknown): WizardDraft {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_DRAFT };
  const source = raw as Record<string, unknown>;
  const draft: WizardDraft = { ...EMPTY_DRAFT };
  for (const field of DRAFT_FIELDS) {
    const value = source[field];
    if (typeof value === 'string') draft[field] = value;
  }
  return draft;
}

export function splitFullName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  const [first, ...rest] = parts;
  return { firstName: first ?? '', lastName: rest.join(' ') };
}

export function splitLocation(value: string): { city: string; state: string; country: string } {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return { city: '', state: '', country: '' };
  if (parts.length === 1) return { city: parts[0] ?? '', state: '', country: '' };
  if (parts.length === 2) return { city: parts[0] ?? '', state: '', country: parts[1] ?? '' };
  return { city: parts[0] ?? '', state: parts[1] ?? '', country: parts[parts.length - 1] ?? '' };
}

export function splitSkills(value: string): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const raw of value.split(',')) {
    const skill = raw.trim();
    if (skill.length === 0) continue;
    const dedupeKey = skill.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    skills.push(skill);
  }
  return skills;
}

export const YEARS_OF_EXPERIENCE_QUESTION = 'years of experience';

export function profileFromWizard(draft: WizardDraft, id: string, now: number): Profile {
  const base = createEmptyProfile(id, 'Default', now);
  const { firstName, lastName } = splitFullName(draft.fullName);
  const { city, state, country } = splitLocation(draft.location);
  const role = draft.role.trim();
  const years = draft.yearsExp.trim();
  const location = draft.location.trim();

  return {
    ...base,
    isDefault: true,
    personal: {
      ...base.personal,
      firstName,
      lastName,
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      address: { ...base.personal.address, city, state, country },
    },
    links: {
      ...base.links,
      linkedin: draft.linkedin.trim(),
      github: draft.github.trim(),
      portfolio: draft.portfolio.trim(),
      other: [],
    },
    work:
      role === ''
        ? []
        : [
            {
              title: role,
              company: '',
              location,
              start: '',
              end: null,
              current: true,
              bullets: [],
            },
          ],
    skills: splitSkills(draft.skills),
    answers:
      years === '' ? [] : [{ q: YEARS_OF_EXPERIENCE_QUESTION, a: years, reusable: true }],
  };
}

export async function saveWizardProfile(
  draft: WizardDraft,
  now: number = Date.now(),
  profileId?: string,
): Promise<Profile> {
  const profile = profileFromWizard(draft, profileId ?? randomId('prof'), now);
  await upsertProfile(profile);
  await patchSettings({ activeProfileId: profile.id }, now);
  return profile;
}

function authUrl(popup: 'signup' | 'login'): string {
  const url = new URL('/', WEB_APP_URL);
  url.searchParams.set('popup', popup);
  url.searchParams.set('redirect_url', WEB_AUTH_REDIRECT_PATH);
  return url.toString();
}

const FIELDS: Record<'about' | 'experience' | 'links', readonly FieldSpec[]> = {
  about: [
    { key: 'fullName', label: 'Full name', placeholder: 'Yatin Dora', autoComplete: 'name' },
    { key: 'phone', label: 'Phone', placeholder: '+91', autoComplete: 'tel' },
    { key: 'email', label: 'Email', placeholder: 'you@example.com', autoComplete: 'email', type: 'email' },
    { key: 'location', label: 'Location', placeholder: 'Bengaluru, IN' },
  ],
  experience: [
    { key: 'role', label: 'Current role', placeholder: 'Frontend Developer' },
    { key: 'yearsExp', label: 'Years of experience', placeholder: '5' },
    { key: 'skills', label: 'Top skills', hint: 'comma-separated', placeholder: 'React, Node.js, PostgreSQL' },
  ],
  links: [
    { key: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/yatindora' },
    { key: 'github', label: 'GitHub', placeholder: 'github.com/YatinDora81' },
    { key: 'portfolio', label: 'Portfolio', hint: 'optional', placeholder: 'yatin.dev' },
  ],
};

interface FieldSpec {
  key: keyof WizardDraft;
  label: string;
  hint?: string;
  placeholder?: string;
  autoComplete?: string;
  type?: string;
}

const STEP_COPY: Record<'about' | 'experience' | 'links', { title: string; sub: string }> = {
  about: { title: 'About you', sub: 'This fills the basics on every application.' },
  experience: { title: 'Your experience', sub: 'Used for role, years and skills questions.' },
  links: { title: 'Your links', sub: 'Filled into profile-URL fields.' },
};

const STEPPER: readonly { step: WizardStep; label: string }[] = [
  { step: 'fork', label: 'Welcome' },
  { step: 'about', label: 'About you' },
  { step: 'experience', label: 'Experience' },
  { step: 'links', label: 'Links' },
  { step: 'ai', label: 'AI' },
];

const FORK_PROMISES: readonly string[] = [
  'Never auto-submits an application',
  'Works fully offline as a guest',
  'AI keys never leave this device',
];

const KEY_ASSURANCES: readonly string[] = [
  'Encrypted on this device',
  'Sent only to Google, never to NextMove',
  'Runs only when you click',
];

export function App(): ReactElement {
  const [step, setStep] = useState<WizardStep>('fork');
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_DRAFT);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [geminiKey, setGeminiKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const profileIdRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void browser.storage.local
      .get(ONBOARDING_DRAFT_KEY)
      .then((bag) => {
        if (!live) return;
        const stored = (bag as Record<string, unknown>)[ONBOARDING_DRAFT_KEY];
        if (stored !== undefined) setDraft(readDraft(stored));
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setHydrated(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || step === 'done') return undefined;
    const timer = setTimeout(() => {
      void browser.storage.local
        .set({ [ONBOARDING_DRAFT_KEY]: draftRef.current })
        .then(() => setSavedAt(Date.now()))
        .catch(() => undefined);
    }, ONBOARDING_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, hydrated, step]);

  const edit = useCallback(
    (key: keyof WizardDraft) => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.currentTarget.value;
      setDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const goNext = useCallback(() => {
    setStep((current) => WIZARD_ORDER[WIZARD_ORDER.indexOf(current) + 1] ?? current);
  }, []);

  const goBack = useCallback(() => {
    setStep((current) => WIZARD_ORDER[Math.max(1, WIZARD_ORDER.indexOf(current) - 1)] ?? current);
  }, []);

  const openAuth = useCallback((popup: 'signup' | 'login') => {
    void browser.tabs.create({ url: authUrl(popup) }).catch(() => undefined);
  }, []);

  const startGuest = useCallback(() => {
    void browser.storage.local.set({ [MODE_KEY]: 'guest' }).catch(() => undefined);
    setStep('about');
  }, []);

  const finishProfile = useCallback(async () => {
    setProfileError(null);
    try {
      const profile = await saveWizardProfile(
        draftRef.current,
        Date.now(),
        profileIdRef.current ?? undefined,
      );
      profileIdRef.current = profile.id;
      setStep('ai');
    } catch (error) {
      setProfileError(describeError(error));
    }
  }, []);

  const finish = useCallback(async () => {
    await browser.storage.local.set({ [ONBOARDED_KEY]: true }).catch(() => undefined);
    await browser.storage.local.remove(ONBOARDING_DRAFT_KEY).catch(() => undefined);
    setStep('done');
  }, []);

  const saveGeminiKey = useCallback(async () => {
    const key = geminiKey.trim();
    if (key.length === 0) {
      setKeyError('Paste a key first.');
      return;
    }
    setKeyBusy(true);
    setKeyError(null);
    try {
      await call('KEYS_ADD', { key, label: 'Gemini key' });
      setGeminiKey('');
      await finish();
    } catch (error) {
      setKeyError(describeError(error));
    } finally {
      setKeyBusy(false);
    }
  }, [geminiKey, finish]);

  if (step === 'fork') {
    return (
      <Shell width={420} tone="base" pad="pt-[70px] pb-16">
        <div className="text-center">
          <img
            src="/icons/128.png"
            alt=""
            width={40}
            height={40}
            className="mx-auto h-10 w-10 rounded-[11px] shadow-[var(--jf-shadow-1)]"
          />
          <h1 className="mt-5 text-[30px] leading-[1.15] font-[650] tracking-[-0.025em] text-[var(--jf-fg)]">
            Every application,
            <br />
            one click.
          </h1>
          <p className="mt-3 text-[14px] leading-[1.6] text-[var(--jf-fg-muted)]">
            Set up once. Your data stays yours — on this device, or synced to your account. You
            choose.
          </p>
          <div className="mt-6 flex flex-col gap-[9px]">
            <Button variant="primary" size="lg" block onClick={() => openAuth('signup')}>
              Create account
            </Button>
            <Button size="lg" block onClick={() => openAuth('login')}>
              Log in
            </Button>
            <Button size="lg" block onClick={startGuest}>
              Continue as guest
            </Button>
          </div>
          <ul className="mx-auto mt-[26px] flex max-w-[300px] flex-col gap-2 text-left">
            {FORK_PROMISES.map((promise) => (
              <li key={promise} className="flex items-start gap-[9px] text-[13px] text-[var(--jf-fg-muted)]">
                <Check size={14} className="mt-[3px] shrink-0 text-[var(--jf-ok)]" />
                {promise}
              </li>
            ))}
          </ul>
          <p className="mt-[18px] text-[12.5px] text-[var(--jf-fg-subtle)]">
            Guest keeps everything local. Add an account anytime.
          </p>
        </div>
      </Shell>
    );
  }

  if (step === 'done') {
    const firstName = splitFullName(draft.fullName).firstName;
    return (
      <Shell width={430} tone="sunken" pad="pt-16 pb-[60px]">
        <div className="text-center">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--jf-radius-full)] bg-[var(--jf-ok-soft)] text-[var(--jf-ok)]">
            <Check size={21} />
          </span>
          <h1 className="mt-4 text-[27px] leading-[1.15] font-[650] tracking-[-0.022em] text-[var(--jf-fg)]">
            You&apos;re set{firstName === '' ? '' : `, ${firstName}`}.
          </h1>
          <p className="mt-4 inline-flex items-center gap-[9px] rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] px-[14px] py-[11px] text-[13px] text-[var(--jf-fg-muted)]">
            <Pin />
            Pin NextMove to your toolbar — one click away on any job page
          </p>
          <div className="mt-[18px] flex flex-wrap justify-center gap-[9px]">
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                window.close();
              }}
            >
              Try it on a job page
            </Button>
            <Button
              size="lg"
              onClick={() => {
                browser.runtime.openOptionsPage();
              }}
            >
              Open my tracker
            </Button>
          </div>
          <p className="mt-4 text-[12.5px] text-[var(--jf-fg-subtle)]">
            Everything lives on this device · add an account later to back it up
          </p>
        </div>
      </Shell>
    );
  }

  if (step === 'ai') {
    return (
      <Shell width={520} tone="sunken" pad="pt-10 pb-14">
        <Stepper current="ai" />
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-[var(--jf-fg)]">
              Bring your own AI
            </h1>
            <span className="rounded-[var(--jf-radius-full)] bg-[var(--jf-bg-subtle)] px-[9px] py-[3px] text-[11.5px] font-medium text-[var(--jf-fg-muted)]">
              Optional
            </span>
          </div>
          <p className="mt-[5px] text-[13px] leading-[1.6] text-[var(--jf-fg-muted)]">
            A free Gemini key lets NextMove answer open questions like &ldquo;Why this
            company?&rdquo;. Everything else works without it.
          </p>

          <div className="mt-[14px]">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label htmlFor="gemini-key" className="text-[13px] font-medium text-[var(--jf-fg)]">
                Gemini API key
              </label>
              <a
                href={AI_STUDIO_KEY_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12.5px] text-[var(--jf-accent)] hover:underline"
              >
                Get a free key
                <ExternalLink size={12} />
              </a>
            </div>
            <Input
              id="gemini-key"
              type="password"
              spellCheck={false}
              autoComplete="off"
              value={geminiKey}
              onChange={(event) => setGeminiKey(event.currentTarget.value)}
              placeholder="AIza…"
              className="h-[38px] font-[var(--jf-font-mono)] text-[12.5px]"
            />
          </div>

          <ul className="mt-[14px] flex flex-col gap-[7px]">
            {KEY_ASSURANCES.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[12.5px] text-[var(--jf-fg-muted)]">
                <Check size={13} className="mt-[3px] shrink-0 text-[var(--jf-ok)]" />
                {line}
              </li>
            ))}
          </ul>

          {keyError === null ? null : (
            <p role="alert" className="mt-3 text-[12.5px] leading-snug text-[var(--jf-danger)]">
              {keyError}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={goBack}>
              Back
            </Button>
            <Button
              className="ml-auto"
              onClick={() => {
                void finish();
              }}
            >
              Skip for now
            </Button>
            <Button
              variant="primary"
              busy={keyBusy}
              className="px-[18px]"
              onClick={() => {
                void saveGeminiKey();
              }}
            >
              Save key
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }

  const spec = FIELDS[step];
  const copy = STEP_COPY[step];

  return (
    <Shell width={520} tone="sunken" pad="pt-10 pb-14">
      <Stepper current={step} />
      <Card>
        <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-[var(--jf-fg)]">
          {copy.title}
        </h1>
        <p className="mt-[3px] text-[13px] text-[var(--jf-fg-muted)]">{copy.sub}</p>

        <div className={cx('mt-2', step === 'about' && 'grid grid-cols-1 gap-x-4 sm:grid-cols-2')}>
          {spec.map((field) => (
            <div
              key={field.key}
              className={cx(
                'mt-[14px]',
                step === 'about' &&
                  (field.key === 'email' || field.key === 'location') &&
                  'sm:col-span-2',
              )}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <label
                  htmlFor={`wizard-${field.key}`}
                  className="text-[13px] font-medium text-[var(--jf-fg)]"
                >
                  {field.label}
                </label>
                {field.hint === undefined ? null : (
                  <span className="text-[12.5px] text-[var(--jf-fg-subtle)]">{field.hint}</span>
                )}
              </div>
              <Input
                id={`wizard-${field.key}`}
                type={field.type ?? 'text'}
                autoComplete={field.autoComplete}
                placeholder={field.placeholder}
                value={draft[field.key]}
                onChange={edit(field.key)}
                className="h-[38px] text-[13.5px]"
              />
            </div>
          ))}
        </div>

        {profileError === null ? null : (
          <p role="alert" className="mt-3 text-[12.5px] leading-snug text-[var(--jf-danger)]">
            {profileError}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={goBack}>
            Back
          </Button>
          <span className="text-[12px] text-[var(--jf-fg-subtle)]" role="status" aria-live="polite">
            {savedAt === null ? 'Autosaves as you type' : 'Saved just now'}
          </span>
          <Button
            variant="primary"
            className="ml-auto px-5"
            onClick={() => {
              if (step === 'links') void finishProfile();
              else goNext();
            }}
          >
            Continue
          </Button>
        </div>
      </Card>
    </Shell>
  );
}

function Shell({
  children,
  width,
  tone,
  pad,
}: {
  children: ReactNode;
  width: number;
  tone: 'base' | 'sunken';
  pad: string;
}): ReactElement {
  return (
    <div
      className={cx(
        'relative min-h-screen px-6',
        pad,
        tone === 'base' ? 'bg-[var(--jf-bg)]' : 'bg-[var(--jf-bg-subtle)]',
      )}
    >
      {tone === 'base' ? <div aria-hidden className="jf-gridbg" /> : null}
      <main className="relative mx-auto" style={{ maxWidth: width }}>
        {children}
      </main>
    </div>
  );
}

function Card({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="mt-[22px] rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-6 shadow-[var(--jf-shadow-2)]">
      {children}
    </div>
  );
}

function Stepper({ current }: { current: WizardStep }): ReactElement {
  const currentIndex = WIZARD_ORDER.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center justify-center gap-2">
      {STEPPER.map((entry, index) => {
        const entryIndex = WIZARD_ORDER.indexOf(entry.step);
        const done = entryIndex < currentIndex;
        const active = entryIndex === currentIndex;
        return (
          <li key={entry.step} className="flex items-center gap-2">
            {index === 0 ? null : (
              <span aria-hidden className="h-px w-[18px] bg-[var(--jf-hairline-strong)]" />
            )}
            <span
              aria-current={active ? 'step' : undefined}
              className={cx(
                'inline-flex items-center gap-1 text-[12.5px]',
                active
                  ? 'font-semibold text-[var(--jf-accent)]'
                  : done
                    ? 'text-[var(--jf-fg-muted)]'
                    : 'text-[var(--jf-fg-subtle)]',
              )}
            >
              {entry.label}
              {done ? <Check size={13} className="text-[var(--jf-ok)]" /> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Pin(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      aria-hidden
      focusable="false"
      className="shrink-0 text-[var(--jf-fg-subtle)]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6Z" />
      <path d="M12 14v7" />
    </svg>
  );
}
