import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { COMPANY_TOKEN } from '@/shared/constants';
import type { AnswerRecord, AnswerScope, AnswerSource } from '@/shared/types';

import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  PanelHeader,
  Select,
  Switch,
  Textarea,
  toast,
} from '@/ui/components';
import { formatRelative, plural, truncate } from '@/ui/format';
import { orderAnswers, useAnswersStore, useProfilesStore } from '@/ui/store';
import { useDebouncedValue } from '@/ui/useDebouncedValue';

const SOURCE_LABEL: Record<AnswerSource, string> = {
  ai: 'AI draft',
  'ai-edited': 'AI, edited by you',
  user: 'Written by you',
};

const SOURCE_TONE = {
  ai: 'accent',
  'ai-edited': 'ok',
  user: 'neutral',
} as const;

interface EditorState {
  record: AnswerRecord | null;
  question: string;
  answer: string;
  scope: AnswerScope;
}

const BLANK_EDITOR: EditorState = {
  record: null,
  question: '',
  answer: '',
  scope: 'profile',
};

/**
 * How long "Clear all" stays armed. Clearing the bank is irreversible and the second click is the
 * whole confirmation, so it must not survive the user's attention wandering — an accidental
 * double-click a minute later would empty the bank with no dialog in the way.
 */
const CONFIRM_WINDOW_MS = 6_000;

export function AnswersPanel(): ReactElement {
  const records = useAnswersStore((state) => state.records);
  const total = useAnswersStore((state) => state.total);
  const search = useAnswersStore((state) => state.search);
  const pinned = useAnswersStore((state) => state.pinned);
  const loading = useAnswersStore((state) => state.loading);
  const error = useAnswersStore((state) => state.error);
  const load = useAnswersStore((state) => state.load);
  const setSearch = useAnswersStore((state) => state.setSearch);
  const setProfileFilter = useAnswersStore((state) => state.setProfileFilter);
  const profileFilter = useAnswersStore((state) => state.profileId);
  const save = useAnswersStore((state) => state.save);
  const remove = useAnswersStore((state) => state.remove);
  const togglePin = useAnswersStore((state) => state.togglePin);
  const clear = useAnswersStore((state) => state.clear);

  const profiles = useProfilesStore((state) => state.profiles);
  const activeProfileId = useProfilesStore((state) => state.activeProfileId);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AnswerRecord | null>(null);
  const [armed, setArmed] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebouncedValue(searchInput);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (debouncedSearch === search) return;
    void setSearch(debouncedSearch);
  }, [debouncedSearch, search, setSearch]);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const ordered = orderAnswers(records, pinned);

  // A filter can hide every row while the bank is still full, and ANSWERS_CLEAR ignores filters —
  // so offer the control whenever the bank might hold something, not just when rows are on screen.
  const filtered = search.trim() !== '' || profileFilter !== null;
  const canClear = total > 0 || filtered;

  const openNew = (): void => setEditor({ ...BLANK_EDITOR });

  const openEdit = (record: AnswerRecord): void =>
    setEditor({
      record,
      question: record.qRaw,
      answer: record.answer,
      scope: record.scope,
    });

  const submit = async (): Promise<void> => {
    const current = editor;
    if (current === null) return;
    const question = current.question.trim();
    const answer = current.answer.trim();
    if (question === '' || answer === '') return;

    const saved = await save({
      qRaw: question,
      answer,
      source: current.record === null ? 'user' : current.record.source === 'ai' ? 'ai-edited' : current.record.source,
      profileId: current.scope === 'global' ? null : (current.record?.profileId ?? activeProfileId),
      scope: current.scope,
    });
    setEditor(null);
    if (saved === null) toast.error('Could not save that answer.');
    else toast.ok('Answer banked.');
  };

  const clearAll = async (): Promise<void> => {
    setArmed(false);
    setClearing(true);
    const cleared = await clear();
    setClearing(false);
    if (cleared === null) toast.error('The bank could not be cleared.');
    else toast.ok(`Cleared ${String(cleared)} ${plural(cleared, 'answer')}.`);
  };

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Answer Bank"
        description="Screening questions repeat brutally across applications. Every answer you accept is saved here, and the next time the same — or a similar — question appears, NextMove offers it before spending a single API call."
        actions={
          <>
            {!canClear ? null : armed ? (
              <>
                <Button onClick={() => setArmed(false)}>Keep them</Button>
                <Button
                  variant="danger"
                  busy={clearing}
                  onClick={() => {
                    void clearAll();
                  }}
                >
                  Delete every answer — sure?
                </Button>
              </>
            ) : (
              <Button variant="danger" busy={clearing} onClick={() => setArmed(true)}>
                Clear all
              </Button>
            )}
            <Button variant="primary" onClick={openNew}>
              Add an answer
            </Button>
          </>
        }
      />

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" className="min-w-64 flex-1">
          {(props) => (
            <Input
              {...props}
              type="search"
              value={searchInput}
              placeholder="sponsorship, why us, notice period…"
              onChange={(event) => setSearchInput(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Profile" className="min-w-48">
          {(props) => (
            <Select
              {...props}
              value={profileFilter ?? ''}
              onChange={(event) => {
                void setProfileFilter(event.currentTarget.value === '' ? null : event.currentTarget.value);
              }}
            >
              <option value="">Every profile</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label === '' ? 'Untitled profile' : profile.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="pb-2 text-xs text-[var(--jf-fg-muted)]">
          {total} banked {plural(total, 'answer')}
        </p>
      </div>

      {loading && records.length === 0 ? (
        <p className="text-sm text-[var(--jf-fg-muted)]">Loading the bank…</p>
      ) : ordered.length === 0 ? (
        <EmptyState
          title={search === '' ? 'Nothing banked yet' : 'No answers match that search'}
          description={
            search === ''
              ? 'Answers arrive here automatically the first time you accept one on a real application — generated, edited, or typed from scratch.'
              : undefined
          }
          action={
            search === '' ? undefined : (
              <Button
                onClick={() => {
                  setSearchInput('');
                  void setSearch('');
                }}
              >
                Clear search
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((record) => {
            const isPinned = pinned.has(record.id);
            return (
              <Card as="li" key={record.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--jf-fg)]">{record.qRaw}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-[var(--jf-fg-subtle)]">
                      {truncate(record.qNorm, 120)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {isPinned ? <Badge tone="warn">Pinned</Badge> : null}
                    <Badge tone={SOURCE_TONE[record.source]}>{SOURCE_LABEL[record.source]}</Badge>
                    <Badge tone={record.scope === 'global' ? 'accent' : 'neutral'}>
                      {record.scope === 'global' ? 'All profiles' : 'This profile'}
                    </Badge>
                    {record.template ? (
                      <Badge tone="muted" title="The company name is re-substituted on every reuse">
                        {COMPANY_TOKEN}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-[var(--jf-fg-muted)]">
                  {record.answer}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-xs text-[var(--jf-fg-subtle)]">
                    Used on {record.timesUsed} {plural(record.timesUsed, 'application')}
                    {record.timesUsed > 0 ? ` · last ${formatRelative(record.lastUsedAt)}` : ''}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        void togglePin(record.id);
                      }}
                    >
                      {isPinned ? 'Unpin' : 'Pin'}
                    </Button>
                    <Button size="sm" onClick={() => openEdit(record)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setPendingDelete(record)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      <Notice tone="info">
        Reuse is a fully offline path: looking an answer up costs no API call, no key lease and no
        network. Only pressing &ldquo;Regenerate&rdquo; on a real form enters the Gemini path.
      </Notice>

      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={editor?.record === null ? 'Add an answer' : 'Edit answer'}
        description="Questions are normalized before matching, so wording differences do not matter. Write the company name as it appears — NextMove replaces it with a placeholder before banking."
        footer={
          <>
            <Button onClick={() => setEditor(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={
                editor === null || editor.question.trim() === '' || editor.answer.trim() === ''
              }
              onClick={() => {
                void submit();
              }}
            >
              Save answer
            </Button>
          </>
        }
      >
        {editor === null ? null : (
          <div className="flex flex-col gap-3">
            <Field label="Question" hint="As the form asks it.">
              {(props) => (
                <Input
                  {...props}
                  autoFocus
                  value={editor.question}
                  placeholder="Why do you want to work at Acme?"
                  onChange={(event) =>
                    setEditor({ ...editor, question: event.currentTarget.value })
                  }
                />
              )}
            </Field>
            <Field label="Answer" hint="2–5 sentences reads best on almost every ATS.">
              {(props) => (
                <Textarea
                  {...props}
                  rows={6}
                  value={editor.answer}
                  onChange={(event) => setEditor({ ...editor, answer: event.currentTarget.value })}
                />
              )}
            </Field>
            <Switch
              checked={editor.scope === 'global'}
              onChange={(checked) => setEditor({ ...editor, scope: checked ? 'global' : 'profile' })}
              label="Offer this on every profile"
              hint="Off by default — a “Frontend” answer usually differs from a “Fullstack” one."
            />
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target === null) return;
          void remove(target.id).then(() => toast.ok('Answer deleted.'));
        }}
        title="Delete this answer?"
        description="It stops being offered on future applications. Applications you already submitted are unaffected."
        confirmLabel="Delete answer"
      />
    </div>
  );
}
