import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type {
  CompensationPeriod,
  EducationEntry,
  Profile,
  ProfileAnswer,
  RemotePreference,
  WorkEntry,
} from '@/shared/types';

import {
  Badge,
  Button,
  ChipList,
  EmptyState,
  Field,
  FieldGrid,
  FieldSet,
  Input,
  Meter,
  Notice,
  PanelHeader,
  Repeater,
  Select,
  Switch,
  Textarea,
  toast,
} from '@/ui/components';
import { computeCompleteness } from '@/ui/completeness';
import { selectEditingProfile, useProfilesStore } from '@/ui/store';

function cloneProfile(profile: Profile): Profile {
  return {
    ...profile,
    personal: { ...profile.personal, address: { ...profile.personal.address } },
    links: { ...profile.links, other: [...profile.links.other] },
    work: profile.work.map((entry) => ({ ...entry, bullets: [...entry.bullets] })),
    education: profile.education.map((entry) => ({ ...entry })),
    skills: [...profile.skills],
    authorization: {
      ...profile.authorization,
      authorizedIn: [...profile.authorization.authorizedIn],
      needsSponsorship: { ...profile.authorization.needsSponsorship },
    },
    eeo: { ...profile.eeo },
    compensation: {
      expected: { ...profile.compensation.expected },
      noticePeriodDays: profile.compensation.noticePeriodDays,
    },
    answers: profile.answers.map((answer) => ({ ...answer })),
  };
}

const REMOTE_PREFERENCES: readonly RemotePreference[] = ['onsite', 'hybrid', 'remote', 'flexible'];
const PERIODS: readonly CompensationPeriod[] = ['hour', 'day', 'month', 'year'];

const EEO_DECLINE = 'Decline to state';

function newWorkEntry(): WorkEntry {
  return {
    title: '',
    company: '',
    location: '',
    start: '',
    end: null,
    current: false,
    bullets: [''],
  };
}

function newEducationEntry(): EducationEntry {
  return { school: '', degree: '', field: '', start: '', end: null, gpa: '' };
}

function newAnswer(): ProfileAnswer {
  return { q: '', a: '', reusable: true };
}

export function ProfilePanel(): ReactElement {
  const stored = useProfilesStore(selectEditingProfile);
  const profiles = useProfilesStore((state) => state.profiles);
  const loading = useProfilesStore((state) => state.loading);
  const saving = useProfilesStore((state) => state.saving);
  const save = useProfilesStore((state) => state.save);
  const create = useProfilesStore((state) => state.create);

  const [draft, setDraft] = useState<Profile | null>(null);

  useEffect(() => {
    setDraft(stored === null ? null : cloneProfile(stored));
  }, [stored]);

  const patch = useCallback((changes: Partial<Profile>) => {
    setDraft((current) => (current === null ? current : { ...current, ...changes }));
  }, []);

  const completeness = useMemo(() => computeCompleteness(draft), [draft]);
  const dirty = useMemo(
    () => draft !== null && stored !== null && JSON.stringify(draft) !== JSON.stringify(stored),
    [draft, stored],
  );

  const onSave = useCallback(async () => {
    if (draft === null) return;
    const saved = await save({ ...draft, updatedAt: Date.now() });
    if (saved === null) toast.error('Could not save your profile — see the message above.');
    else toast.ok('Profile saved.');
  }, [draft, save]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void onSave();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSave]);

  if (loading && draft === null) {
    return <p className="text-sm text-[var(--jf-fg-muted)]">Loading your vault…</p>;
  }

  if (draft === null) {
    return (
      <div className="flex flex-col gap-5">
        <PanelHeader
          title="Profile vault"
          description="Everything an application form can ask for, entered once and kept on this device."
        />
        <EmptyState
          title={profiles.length === 0 ? 'No profile yet' : 'No profile selected'}
          description="Create one by hand, or upload a resume and let Gemini draft it for you."
          action={
            <Button
              variant="primary"
              onClick={() => {
                void create('Default');
              }}
            >
              Create a profile
            </Button>
          }
        />
      </div>
    );
  }

  const eeoDisabled = draft.eeo.declineToState;

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Profile vault"
        description="Everything an application form can ask for, entered once and kept on this device. Nothing here leaves your machine unless you explicitly send it to Gemini or turn on sync."
        actions={
          <>
            {dirty ? <Badge tone="warn">Unsaved changes</Badge> : null}
            <Button
              variant="primary"
              busy={saving}
              disabled={!dirty}
              onClick={() => {
                void onSave();
              }}
            >
              Save profile
            </Button>
          </>
        }
      />

      <CompletenessCard score={completeness.score} missing={completeness.missing} />

      <FieldSet
        legend="This profile"
        description="Profiles share your base identity and override the summary, skills and default resume (F-11)."
      >
        <FieldGrid cols={3}>
          <Field label="Profile name" hint="Shown in the popup switcher, e.g. “Frontend”.">
            {(props) => (
              <Input
                {...props}
                value={draft.label}
                onChange={(event) => patch({ label: event.currentTarget.value })}
              />
            )}
          </Field>
          <div className="flex items-end pb-1.5">
            <Switch
              checked={draft.isDefault}
              onChange={(checked) => patch({ isDefault: checked })}
              label="Default profile"
              hint="Used when a fill run does not name a profile."
            />
          </div>
        </FieldGrid>
        <div className="mt-3">
          <Field
            label="Summary"
            hint="Two or three sentences. This is the first thing an AI answer quotes from."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={draft.summary ?? ''}
                onChange={(event) => patch({ summary: event.currentTarget.value })}
              />
            )}
          </Field>
        </div>
      </FieldSet>

      <FieldSet legend="Personal">
        <FieldGrid cols={2}>
          <Field label="First name" required>
            {(props) => (
              <Input
                {...props}
                autoComplete="given-name"
                value={draft.personal.firstName}
                onChange={(event) =>
                  patch({ personal: { ...draft.personal, firstName: event.currentTarget.value } })
                }
              />
            )}
          </Field>
          <Field label="Last name" required>
            {(props) => (
              <Input
                {...props}
                autoComplete="family-name"
                value={draft.personal.lastName}
                onChange={(event) =>
                  patch({ personal: { ...draft.personal, lastName: event.currentTarget.value } })
                }
              />
            )}
          </Field>
          <Field label="Email" required>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="email"
                value={draft.personal.email}
                onChange={(event) =>
                  patch({ personal: { ...draft.personal, email: event.currentTarget.value } })
                }
              />
            )}
          </Field>
          <Field label="Phone" required hint="Include the country code — many ATS validate it.">
            {(props) => (
              <Input
                {...props}
                type="tel"
                autoComplete="tel"
                value={draft.personal.phone}
                onChange={(event) =>
                  patch({ personal: { ...draft.personal, phone: event.currentTarget.value } })
                }
              />
            )}
          </Field>
        </FieldGrid>
      </FieldSet>

      <FieldSet legend="Address">
        <FieldGrid cols={2}>
          <Field label="Address line 1" className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                value={draft.personal.address.line1}
                onChange={(event) =>
                  patch({
                    personal: {
                      ...draft.personal,
                      address: { ...draft.personal.address, line1: event.currentTarget.value },
                    },
                  })
                }
              />
            )}
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                value={draft.personal.address.line2}
                onChange={(event) =>
                  patch({
                    personal: {
                      ...draft.personal,
                      address: { ...draft.personal.address, line2: event.currentTarget.value },
                    },
                  })
                }
              />
            )}
          </Field>
          <Field label="City">
            {(props) => (
              <Input
                {...props}
                value={draft.personal.address.city}
                onChange={(event) =>
                  patch({
                    personal: {
                      ...draft.personal,
                      address: { ...draft.personal.address, city: event.currentTarget.value },
                    },
                  })
                }
              />
            )}
          </Field>
          <Field label="State / region">
            {(props) => (
              <Input
                {...props}
                value={draft.personal.address.state}
                onChange={(event) =>
                  patch({
                    personal: {
                      ...draft.personal,
                      address: { ...draft.personal.address, state: event.currentTarget.value },
                    },
                  })
                }
              />
            )}
          </Field>
          <Field label="Postal code">
            {(props) => (
              <Input
                {...props}
                value={draft.personal.address.postalCode}
                onChange={(event) =>
                  patch({
                    personal: {
                      ...draft.personal,
                      address: { ...draft.personal.address, postalCode: event.currentTarget.value },
                    },
                  })
                }
              />
            )}
          </Field>
          <Field label="Country" hint="Two-letter code where you know it — “IN”, “US”.">
            {(props) => (
              <Input
                {...props}
                value={draft.personal.address.country}
                onChange={(event) =>
                  patch({
                    personal: {
                      ...draft.personal,
                      address: { ...draft.personal.address, country: event.currentTarget.value },
                    },
                  })
                }
              />
            )}
          </Field>
        </FieldGrid>
      </FieldSet>

      <FieldSet legend="Links">
        <FieldGrid cols={3}>
          <Field label="LinkedIn">
            {(props) => (
              <Input
                {...props}
                type="url"
                value={draft.links.linkedin}
                onChange={(event) =>
                  patch({ links: { ...draft.links, linkedin: event.currentTarget.value } })
                }
              />
            )}
          </Field>
          <Field label="GitHub">
            {(props) => (
              <Input
                {...props}
                type="url"
                value={draft.links.github}
                onChange={(event) =>
                  patch({ links: { ...draft.links, github: event.currentTarget.value } })
                }
              />
            )}
          </Field>
          <Field label="Portfolio">
            {(props) => (
              <Input
                {...props}
                type="url"
                value={draft.links.portfolio}
                onChange={(event) =>
                  patch({ links: { ...draft.links, portfolio: event.currentTarget.value } })
                }
              />
            )}
          </Field>
        </FieldGrid>
        <div className="mt-3">
          <Field label="Other links" hint="Dribbble, Google Scholar, a personal blog…">
            {(props) => (
              <ChipList
                id={props.id}
                describedBy={props['aria-describedby']}
                value={draft.links.other}
                onChange={(other) => patch({ links: { ...draft.links, other } })}
                placeholder="https://… then Enter"
              />
            )}
          </Field>
        </div>
      </FieldSet>

      <FieldSet
        legend="Work history"
        description="Bullets are what AI screening answers and cover letters quote from, so write them as concrete achievements rather than duties."
      >
        <Repeater
          items={draft.work}
          onChange={(work) => patch({ work })}
          create={newWorkEntry}
          addLabel="Add a role"
          emptyLabel="No roles yet."
          title={(entry) =>
            entry.title === '' && entry.company === ''
              ? 'New role'
              : `${entry.title}${entry.title !== '' && entry.company !== '' ? ' · ' : ''}${entry.company}`
          }
        >
          {(entry, update) => (
            <div className="flex flex-col gap-3">
              <FieldGrid cols={2}>
                <Field label="Job title">
                  {(props) => (
                    <Input
                      {...props}
                      value={entry.title}
                      onChange={(event) => update({ title: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field label="Company">
                  {(props) => (
                    <Input
                      {...props}
                      value={entry.company}
                      onChange={(event) => update({ company: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field label="Location">
                  {(props) => (
                    <Input
                      {...props}
                      value={entry.location}
                      onChange={(event) => update({ location: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <div className="flex items-end pb-1.5">
                  <Switch
                    checked={entry.current}
                    onChange={(current) => update({ current, end: current ? null : (entry.end ?? '') })}
                    label="I work here now"
                  />
                </div>
                <Field label="Start" hint="YYYY-MM">
                  {(props) => (
                    <Input
                      {...props}
                      type="month"
                      value={entry.start}
                      onChange={(event) => update({ start: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field label="End" hint={entry.current ? 'Current role' : 'YYYY-MM'}>
                  {(props) => (
                    <Input
                      {...props}
                      type="month"
                      disabled={entry.current}
                      value={entry.end ?? ''}
                      onChange={(event) =>
                        update({
                          end: event.currentTarget.value === '' ? null : event.currentTarget.value,
                        })
                      }
                    />
                  )}
                </Field>
              </FieldGrid>
              <Field label="Bullets">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={Math.max(3, entry.bullets.length + 1)}
                    value={entry.bullets.join('\n')}
                    placeholder={'Cut checkout latency 40% by…\nShipped the payments SDK used by…'}
                    onChange={(event) =>
                      update({ bullets: event.currentTarget.value.split('\n') })
                    }
                  />
                )}
              </Field>
            </div>
          )}
        </Repeater>
      </FieldSet>

      <FieldSet legend="Education">
        <Repeater
          items={draft.education}
          onChange={(education) => patch({ education })}
          create={newEducationEntry}
          addLabel="Add a school"
          emptyLabel="No education entries yet."
          title={(entry) => (entry.school === '' ? 'New entry' : entry.school)}
        >
          {(entry, update) => (
            <FieldGrid cols={3}>
              <Field label="School">
                {(props) => (
                  <Input
                    {...props}
                    value={entry.school}
                    onChange={(event) => update({ school: event.currentTarget.value })}
                  />
                )}
              </Field>
              <Field label="Degree">
                {(props) => (
                  <Input
                    {...props}
                    value={entry.degree}
                    onChange={(event) => update({ degree: event.currentTarget.value })}
                  />
                )}
              </Field>
              <Field label="Field of study">
                {(props) => (
                  <Input
                    {...props}
                    value={entry.field}
                    onChange={(event) => update({ field: event.currentTarget.value })}
                  />
                )}
              </Field>
              <Field label="Start" hint="YYYY-MM">
                {(props) => (
                  <Input
                    {...props}
                    type="month"
                    value={entry.start}
                    onChange={(event) => update({ start: event.currentTarget.value })}
                  />
                )}
              </Field>
              <Field label="End" hint="Blank if you are still studying">
                {(props) => (
                  <Input
                    {...props}
                    type="month"
                    value={entry.end ?? ''}
                    onChange={(event) =>
                      update({
                        end: event.currentTarget.value === '' ? null : event.currentTarget.value,
                      })
                    }
                  />
                )}
              </Field>
              <Field label="GPA / grade" hint="Free text — “8.4/10”, “3.9”, “First class”.">
                {(props) => (
                  <Input
                    {...props}
                    value={entry.gpa}
                    onChange={(event) => update({ gpa: event.currentTarget.value })}
                  />
                )}
              </Field>
            </FieldGrid>
          )}
        </Repeater>
      </FieldSet>

      <FieldSet legend="Skills">
        <Field label="Skills" hint="Enter or comma adds one. These feed both matching and AI answers.">
          {(props) => (
            <ChipList
              id={props.id}
              describedBy={props['aria-describedby']}
              value={draft.skills}
              onChange={(skills) => patch({ skills })}
              placeholder="TypeScript, React, Node.js"
            />
          )}
        </Field>
      </FieldSet>

      <FieldSet
        legend="Work authorization"
        description="The questions every ATS asks. Sponsorship is per country, because the honest answer usually is."
      >
        <FieldGrid cols={2}>
          <Field
            label="Authorized to work in"
            hint="Country codes you may already work in, e.g. IN, US."
          >
            {(props) => (
              <ChipList
                id={props.id}
                describedBy={props['aria-describedby']}
                value={draft.authorization.authorizedIn}
                onChange={(authorizedIn) =>
                  patch({ authorization: { ...draft.authorization, authorizedIn } })
                }
                placeholder="IN"
              />
            )}
          </Field>
          <Field label="Visa status" hint="Free text — “H-1B”, “Citizen”, “Student visa”.">
            {(props) => (
              <Input
                {...props}
                value={draft.authorization.visaStatus}
                onChange={(event) =>
                  patch({
                    authorization: {
                      ...draft.authorization,
                      visaStatus: event.currentTarget.value,
                    },
                  })
                }
              />
            )}
          </Field>
          <Field label="Remote preference">
            {(props) => (
              <Select
                {...props}
                value={draft.authorization.remotePreference}
                onChange={(event) =>
                  patch({
                    authorization: {
                      ...draft.authorization,
                      remotePreference: event.currentTarget.value as RemotePreference,
                    },
                  })
                }
              >
                {REMOTE_PREFERENCES.map((preference) => (
                  <option key={preference} value={preference}>
                    {preference.charAt(0).toUpperCase() + preference.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex items-end pb-1.5">
            <Switch
              checked={draft.authorization.willingToRelocate}
              onChange={(willingToRelocate) =>
                patch({ authorization: { ...draft.authorization, willingToRelocate } })
              }
              label="Willing to relocate"
            />
          </div>
        </FieldGrid>

        <div className="mt-4">
          <SponsorshipEditor
            value={draft.authorization.needsSponsorship}
            onChange={(needsSponsorship) =>
              patch({ authorization: { ...draft.authorization, needsSponsorship } })
            }
          />
        </div>
      </FieldSet>

      <FieldSet
        legend="EEO / diversity"
        description="Voluntary, and legally never a hiring factor. Set the switch below and NextMove answers “decline to state” everywhere instead of storing anything."
      >
        <Switch
          checked={draft.eeo.declineToState}
          onChange={(declineToState) => patch({ eeo: { ...draft.eeo, declineToState } })}
          label="Decline to state on every EEO question"
          hint="Overrides the four answers below for every form, on every site."
        />
        <FieldGrid cols={4} className="mt-3">
          {(
            [
              ['gender', 'Gender'],
              ['ethnicity', 'Ethnicity'],
              ['veteran', 'Veteran status'],
              ['disability', 'Disability status'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              {(props) => (
                <Input
                  {...props}
                  disabled={eeoDisabled}
                  placeholder={eeoDisabled ? EEO_DECLINE : ''}
                  value={eeoDisabled ? '' : draft.eeo[key]}
                  onChange={(event) => patch({ eeo: { ...draft.eeo, [key]: event.currentTarget.value } })}
                />
              )}
            </Field>
          ))}
        </FieldGrid>
      </FieldSet>

      <FieldSet legend="Compensation & notice">
        <FieldGrid cols={4}>
          <Field label="Expected amount">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step={1000}
                value={draft.compensation.expected.amount === 0 ? '' : draft.compensation.expected.amount}
                onChange={(event) =>
                  patch({
                    compensation: {
                      ...draft.compensation,
                      expected: {
                        ...draft.compensation.expected,
                        amount: Number(event.currentTarget.value) || 0,
                      },
                    },
                  })
                }
              />
            )}
          </Field>
          <Field label="Currency" hint="ISO code — INR, USD.">
            {(props) => (
              <Input
                {...props}
                maxLength={6}
                value={draft.compensation.expected.currency}
                onChange={(event) =>
                  patch({
                    compensation: {
                      ...draft.compensation,
                      expected: {
                        ...draft.compensation.expected,
                        currency: event.currentTarget.value.toUpperCase(),
                      },
                    },
                  })
                }
              />
            )}
          </Field>
          <Field label="Per">
            {(props) => (
              <Select
                {...props}
                value={draft.compensation.expected.period}
                onChange={(event) =>
                  patch({
                    compensation: {
                      ...draft.compensation,
                      expected: {
                        ...draft.compensation.expected,
                        period: event.currentTarget.value as CompensationPeriod,
                      },
                    },
                  })
                }
              >
                {PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Notice period (days)">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                max={365}
                value={draft.compensation.noticePeriodDays}
                onChange={(event) =>
                  patch({
                    compensation: {
                      ...draft.compensation,
                      noticePeriodDays: Math.max(0, Number(event.currentTarget.value) || 0),
                    },
                  })
                }
              />
            )}
          </Field>
        </FieldGrid>
      </FieldSet>

      <FieldSet
        legend="Custom questions"
        description="Answers you always give, kept with the profile. Recurring screening questions are handled separately by the Answer Bank, which learns them as you apply."
      >
        <Repeater
          items={draft.answers}
          onChange={(answers) => patch({ answers })}
          create={newAnswer}
          addLabel="Add a question"
          emptyLabel="No custom questions yet."
          title={(entry) => (entry.q === '' ? 'New question' : entry.q)}
        >
          {(entry, update) => (
            <div className="flex flex-col gap-3">
              <Field label="Question">
                {(props) => (
                  <Input
                    {...props}
                    value={entry.q}
                    onChange={(event) => update({ q: event.currentTarget.value })}
                  />
                )}
              </Field>
              <Field label="Answer">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={3}
                    value={entry.a}
                    onChange={(event) => update({ a: event.currentTarget.value })}
                  />
                )}
              </Field>
              <Switch
                checked={entry.reusable}
                onChange={(reusable) => update({ reusable })}
                label="Reuse this answer on other applications"
              />
            </div>
          )}
        </Repeater>
      </FieldSet>

      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t border-[var(--jf-border)] bg-[var(--jf-bg)] px-1 py-3">
        {dirty ? (
          <span className="text-xs text-[var(--jf-fg-muted)]">
            Unsaved changes — ⌘/Ctrl + S also saves.
          </span>
        ) : (
          <span className="text-xs text-[var(--jf-fg-subtle)]">All changes saved.</span>
        )}
        <Button
          variant="primary"
          busy={saving}
          disabled={!dirty}
          onClick={() => {
            void onSave();
          }}
        >
          Save profile
        </Button>
      </div>
    </div>
  );
}

function CompletenessCard({
  score,
  missing,
}: {
  score: number;
  missing: readonly string[];
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const preview = missing.slice(0, expanded ? missing.length : 4);

  return (
    <div className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-4">
      <Meter value={score} label="Profile completeness" />
      {missing.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--jf-ok)]">
          Everything NextMove knows how to ask for is filled in.
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-[var(--jf-fg-muted)]">
            {missing.length} {missing.length === 1 ? 'field' : 'fields'} still missing — each one is
            a question a form will ask you by hand:
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {preview.map((label) => (
              <li key={label}>
                <Badge tone="muted">{label}</Badge>
              </li>
            ))}
          </ul>
          {missing.length > 4 ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1.5 -ml-2"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Show fewer' : `Show all ${missing.length}`}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SponsorshipEditor({
  value,
  onChange,
}: {
  value: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}): ReactElement {
  const [country, setCountry] = useState('');
  const entries = Object.entries(value);

  const add = (): void => {
    const code = country.trim().toUpperCase();
    if (code === '' || code in value) {
      setCountry('');
      return;
    }
    onChange({ ...value, [code]: true });
    setCountry('');
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-[var(--jf-fg-muted)]">
        Will you need visa sponsorship?
      </p>
      {entries.length === 0 ? (
        <p className="text-xs text-[var(--jf-fg-subtle)]">
          No countries added yet. Add the ones you apply in — “US”, “GB”, “DE”.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map(([code, needs]) => (
            <li key={code} className="flex items-center gap-3">
              <span className="w-12 font-mono text-xs text-[var(--jf-fg)]">{code}</span>
              <Select
                aria-label={`Sponsorship needed in ${code}`}
                className="max-w-40"
                value={needs ? 'yes' : 'no'}
                onChange={(event) => onChange({ ...value, [code]: event.currentTarget.value === 'yes' })}
              >
                <option value="yes">Yes — I need sponsorship</option>
                <option value="no">No — I do not</option>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${code}`}
                onClick={() => {
                  const next = { ...value };
                  delete next[code];
                  onChange(next);
                }}
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          aria-label="Country code"
          className="max-w-28"
          maxLength={2}
          placeholder="US"
          value={country}
          onChange={(event) => setCountry(event.currentTarget.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add();
          }}
        />
        <Button size="sm" onClick={add}>
          Add country
        </Button>
      </div>
      <Notice tone="info" className="mt-1">
        A form that asks “are you authorized to work in the United States?” is answered from the
        list above; “will you now or in the future require sponsorship?” is answered from this one.
        They are different questions and NextMove keeps them separate on purpose.
      </Notice>
    </div>
  );
}
