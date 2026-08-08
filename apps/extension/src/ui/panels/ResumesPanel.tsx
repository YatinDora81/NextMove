/**
 * ui/panels/ResumesPanel.tsx — F-02 (resume → profile) and F-05 (auto-attach source of truth).
 *
 * SEC 4.3 Flow C, implemented exactly as written:
 *
 *   1. Upload → the blob is written to IndexedDB **immediately**, before anything else happens.
 *      It is local, and it stays local: a resume file never leaves this device.
 *   2. pdf.js / mammoth extract the text locally (`@/ai/resume-extract` — no network in that
 *      module, and it is imported from here and nowhere else).
 *   3. An explicit CONSENT SCREEN shows the user the exact text that will be sent, character count
 *      included, *before* the "Build profile with Gemini" button becomes reachable.
 *   4. Gemini returns strict JSON; the user accepts or rejects it field by field.
 *
 * INV-2: the parse is a `RESUME_PARSE` bus message carrying a nonce minted inside the click
 * handler on the consent screen. There is no path from "upload" to "Gemini" that skips step 3.
 *
 * Step 2 lives here, not in the service worker, and that is deliberate on two counts. It is what
 * SEC 4.3 Flow C describes — extraction is a local, user-context operation, and the worker's only
 * contribution is the Gemini call. And it keeps pdfjs-dist and mammoth out of the MV3 worker, which
 * is bundled as a single file that Chrome re-parses on every wake-up; here they are real lazy
 * chunks that a user who never parses a resume never downloads.
 *
 * The consequence for the consent screen is that the promise gets stronger, not weaker: the string
 * rendered in the <pre> below is the very string put on the wire, because `runParse` sends
 * `session.text` itself rather than asking the worker to go and re-read something.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent, ReactElement } from 'react';

import { extractResumeText } from '@/ai/resume-extract';
import { sendMessage } from '@/platform/bus';
import { randomId } from '@/platform/crypto';
import {
  deleteResume,
  listResumes,
  putParseCache,
  putResume,
  setDefaultResume,
} from '@/platform/db';
import { MAX_RESUME_CHARS } from '@/shared/constants';
import type { Profile, ProfileDraft, ResumeRecord } from '@/shared/types';

import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  Modal,
  Notice,
  PanelHeader,
  Switch,
  cx,
  toast,
} from '@/ui/components';
import { buildDiff, type DiffEntry } from '@/ui/diff';
import { pickFile } from '@/ui/download';
import { formatBytes, formatRelative } from '@/ui/format';
import { mintGesture } from '@/ui/gesture';
import { describeError, selectEditingProfile, useKeysStore, useProfilesStore } from '@/ui/store';

const ACCEPT = '.pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type Stage = 'idle' | 'extracting' | 'consent' | 'parsing' | 'review';

interface ParseSession {
  resume: ResumeRecord;
  text: string;
  chars: number;
  truncated: boolean;
  draft: ProfileDraft | null;
  source: 'ai' | 'regex' | null;
  model: string | null;
}

export function ResumesPanel(): ReactElement {
  const profile = useProfilesStore(selectEditingProfile);
  const activeProfileId = useProfilesStore((state) => state.activeProfileId);
  const saveProfile = useProfilesStore((state) => state.save);
  const keys = useKeysStore((state) => state.keys);
  const loadKeys = useKeysStore((state) => state.load);

  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [session, setSession] = useState<ParseSession | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<ResumeRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasKeys = keys.some((key) => key.status !== 'DEAD');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setResumes(await listResumes());
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadKeys();
  }, [refresh, loadKeys]);

  /* -- upload ------------------------------------------------------------------------------- */

  const ingest = useCallback(
    async (files: readonly File[]) => {
      let added = 0;
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(`${file.name} is larger than 10 MB — that is bigger than any ATS accepts.`);
          continue;
        }
        const record: ResumeRecord = {
          id: randomId('res'),
          // Shared across profiles by default; the picker below can pin it to one.
          profileId: null,
          name: file.name,
          mime: file.type,
          size: file.size,
          blob: file,
          tags: [],
          isDefault: false,
          addedAt: Date.now(),
        };
        // Step 1 of Flow C: stored locally, immediately, before any parsing is even considered.
        await putResume(record);
        added += 1;
      }
      if (added === 0) return;
      const all = await listResumes();
      // First resume in the vault becomes the default so F-05 attach has something to reach for.
      if (!all.some((resume) => resume.isDefault)) {
        const first = all[0];
        if (first !== undefined) await setDefaultResume(first.id);
      }
      await refresh();
      toast.ok(`${added} ${added === 1 ? 'resume' : 'resumes'} stored on this device.`);
    },
    [refresh],
  );

  const onPick = useCallback(async () => {
    const file = await pickFile(ACCEPT);
    if (file !== null) await ingest([file]);
  }, [ingest]);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) void ingest(files);
    },
    [ingest],
  );

  /* -- Flow C ------------------------------------------------------------------------------- */

  const beginParse = useCallback(async (resume: ResumeRecord) => {
    setError(null);
    setStage('extracting');
    setSession({
      resume,
      text: '',
      chars: 0,
      truncated: false,
      draft: null,
      source: null,
      model: null,
    });
    try {
      // Step 2: pdf.js / mammoth, entirely on this device. No network call happens here.
      const extracted = await extractResumeText(resume.blob, {
        mime: resume.mime,
        name: resume.name,
      });
      if (extracted.text.trim() === '') {
        setStage('idle');
        setSession(null);
        toast.error(
          `No text layer found in ${resume.name}. Scanned or image-only PDFs cannot be read — export a text PDF or a DOCX.`,
        );
        return;
      }
      // Cache what we are about to show, so the text the service worker sends is byte-for-byte the
      // text the consent screen displayed (SEC 7.1 `parseCache`).
      await putParseCache({
        resumeId: resume.id,
        text: extracted.text,
        draft: null,
        model: null,
        parsedAt: Date.now(),
      });
      setSession({
        resume,
        text: extracted.text,
        chars: extracted.chars,
        truncated: extracted.truncated,
        draft: null,
        source: null,
        model: null,
      });
      setStage('consent');
    } catch (caught) {
      setStage('idle');
      setSession(null);
      toast.error(`Could not read ${resume.name}: ${describeError(caught)}`);
    }
  }, []);

  const runParse = useCallback(async () => {
    const current = session;
    if (current === null) return;
    setStage('parsing');
    try {
      // INV-2: the nonce is minted here, inside the click that follows the consent screen, and is
      // spent immediately. Nothing is cached, nothing is speculative.
      const gesture = await mintGesture('build profile with Gemini');
      // The text shown on the consent screen, sent verbatim — nothing else leaves this device.
      const reply = await sendMessage(
        'RESUME_PARSE',
        { resumeId: current.resume.id, text: current.text },
        gesture,
      );
      if (!reply.ok) {
        setStage('consent');
        toast.error(reply.error.message);
        return;
      }
      setSession({
        ...current,
        draft: reply.data.draft,
        source: reply.data.source,
        model: reply.data.model,
      });
      setAccepted(new Set());
      setStage('review');
    } catch (caught) {
      setStage('consent');
      toast.error(describeError(caught));
    }
  }, [session]);

  const diff = useMemo<DiffEntry[]>(() => {
    const draft = session?.draft ?? null;
    if (draft === null || profile === null) return [];
    return buildDiff(profile, draft);
  }, [profile, session]);

  const changed = useMemo(() => diff.filter((entry) => entry.changed), [diff]);

  const applyAccepted = useCallback(async () => {
    if (profile === null || (session?.draft ?? null) === null) return;
    let next: Profile = profile;
    for (const entry of diff) {
      if (!accepted.has(entry.id)) continue;
      next = entry.apply(next);
    }
    const saved = await saveProfile({ ...next, updatedAt: Date.now() });
    if (saved === null) {
      toast.error('Could not save the accepted fields.');
      return;
    }
    toast.ok(`${accepted.size} ${accepted.size === 1 ? 'field' : 'fields'} written to your vault.`);
    setStage('idle');
    setSession(null);
    setAccepted(new Set());
  }, [accepted, diff, profile, saveProfile, session]);

  /* -- render ------------------------------------------------------------------------------- */

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Resumes"
        description="Your resume files live in this browser's storage and are attached to file inputs straight from there. Only text you explicitly send ever reaches Gemini — the file itself never does."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              void onPick();
            }}
          >
            Upload resume
          </Button>
        }
      />

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'rounded-[var(--jf-radius)] border border-dashed px-6 py-8 text-center transition-colors',
          dragging
            ? 'border-[var(--jf-accent)] bg-[color-mix(in_srgb,var(--jf-accent)_8%,transparent)]'
            : 'border-[var(--jf-border-strong)]',
        )}
      >
        <p className="text-sm text-[var(--jf-fg)]">Drop a PDF or DOCX here</p>
        <p className="mt-1 text-xs text-[var(--jf-fg-muted)]">
          Stored in this browser only, up to 10 MB.{' '}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-[var(--jf-fg)]"
            onClick={() => {
              void onPick();
            }}
          >
            Or choose a file
          </button>
          .
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--jf-fg-muted)]">Loading resumes…</p>
      ) : resumes.length === 0 ? (
        <EmptyState
          title="No resumes yet"
          description="Upload one to auto-attach it to applications, and to draft your profile from it."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {resumes.map((resume) => (
            <Card as="li" key={resume.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-[var(--jf-fg)]">{resume.name}</p>
                  {resume.isDefault ? <Badge tone="accent">Default</Badge> : null}
                  {resume.profileId === null ? (
                    <Badge tone="muted">All profiles</Badge>
                  ) : (
                    <Badge tone="neutral">This profile only</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-[var(--jf-fg-muted)]">
                  {formatBytes(resume.size)} · added {formatRelative(resume.addedAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={resume.isDefault}
                  onClick={() => {
                    void setDefaultResume(resume.id).then(refresh);
                  }}
                >
                  {resume.isDefault ? 'Default' : 'Make default'}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    void putResume({
                      ...resume,
                      profileId: resume.profileId === null ? activeProfileId : null,
                    }).then(refresh);
                  }}
                >
                  {resume.profileId === null ? 'Pin to profile' : 'Share with all'}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    void beginParse(resume);
                  }}
                >
                  Build profile from this
                </Button>
                <Button size="sm" variant="danger" onClick={() => setPendingDelete(resume)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </ul>
      )}

      <Notice tone="info" title="How the attach works (F-05)">
        When a form has a file input, NextMove attaches the default resume for the active profile. If
        several could apply, it asks rather than guessing.
      </Notice>

      {/* ---- Step 3: the consent screen ------------------------------------------------------ */}
      <Modal
        open={stage === 'consent' || stage === 'parsing'}
        onClose={() => {
          if (stage === 'parsing') return;
          setStage('idle');
          setSession(null);
        }}
        width="lg"
        title="This is exactly what will be sent to Google"
        description={
          session === null
            ? undefined
            : `${session.resume.name} · ${session.chars.toLocaleString()} characters of extracted text. Nothing else — not the file, not your vault, not the page you are on.`
        }
        footer={
          <>
            <Button
              disabled={stage === 'parsing'}
              onClick={() => {
                setStage('idle');
                setSession(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={stage === 'parsing'}
              onClick={() => {
                void runParse();
              }}
            >
              {hasKeys ? 'Build profile with Gemini' : 'Build profile without AI'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {hasKeys ? (
            <Notice tone="warn">
              This text is sent over TLS directly to Google&apos;s Gemini API using{' '}
              <strong>your own</strong> API key. It does not pass through any NextMove server. One
              request; the response is a structured profile draft you review before anything is
              saved.
            </Notice>
          ) : (
            <Notice tone="info">
              You have no Gemini key configured, so this runs the built-in offline parser instead.
              It is rougher — it finds contact details, skills and dates reliably, and job history
              less so. Nothing is sent anywhere.
            </Notice>
          )}
          {session?.truncated === true ? (
            <Notice tone="warn">
              This resume is longer than {MAX_RESUME_CHARS.toLocaleString()} characters, so only the
              first {MAX_RESUME_CHARS.toLocaleString()} are shown and sent.
            </Notice>
          ) : null}
          <pre className="max-h-80 overflow-auto rounded-[var(--jf-radius-sm)] border border-[var(--jf-border)] bg-[var(--jf-bg-subtle)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--jf-fg)]">
            {session?.text ?? ''}
          </pre>
        </div>
      </Modal>

      {/* ---- Step 4: field-by-field accept --------------------------------------------------- */}
      <Modal
        open={stage === 'review'}
        onClose={() => {
          setStage('idle');
          setSession(null);
        }}
        width="lg"
        title="Review the draft, field by field"
        description={
          session === null
            ? undefined
            : session.source === 'regex'
              ? 'Drafted by the offline parser. Tick what is right; nothing is written until you apply.'
              : `Drafted by ${session.model ?? 'Gemini'}. Tick what is right; nothing is written until you apply.`
        }
        footer={
          <>
            <Button
              onClick={() => {
                setStage('idle');
                setSession(null);
              }}
            >
              Discard draft
            </Button>
            <Button
              variant="primary"
              disabled={accepted.size === 0}
              onClick={() => {
                void applyAccepted();
              }}
            >
              Apply {accepted.size} {accepted.size === 1 ? 'field' : 'fields'}
            </Button>
          </>
        }
      >
        {changed.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--jf-fg-muted)]">
            The draft matches what is already in your vault. Nothing to change.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 pb-1">
              <p className="text-xs text-[var(--jf-fg-muted)]">
                {changed.length} {changed.length === 1 ? 'difference' : 'differences'} found.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setAccepted(new Set(changed.map((entry) => entry.id)))}
                >
                  Accept all
                </Button>
                <Button size="sm" onClick={() => setAccepted(new Set())}>
                  Accept none
                </Button>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {changed.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-[var(--jf-radius-sm)] border border-[var(--jf-border)] p-3"
                >
                  <Switch
                    checked={accepted.has(entry.id)}
                    onChange={(checked) =>
                      setAccepted((current) => {
                        const next = new Set(current);
                        if (checked) next.add(entry.id);
                        else next.delete(entry.id);
                        return next;
                      })
                    }
                    label={entry.label}
                  />
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-[var(--jf-radius-sm)] bg-[var(--jf-bg-subtle)] p-2">
                      <p className="text-[10px] font-semibold tracking-wide text-[var(--jf-fg-subtle)] uppercase">
                        In your vault
                      </p>
                      <p className="mt-1 text-xs whitespace-pre-wrap text-[var(--jf-fg-muted)]">
                        {entry.current === '' ? '—' : entry.current}
                      </p>
                    </div>
                    <div className="rounded-[var(--jf-radius-sm)] bg-[color-mix(in_srgb,var(--jf-accent)_8%,transparent)] p-2">
                      <p className="text-[10px] font-semibold tracking-wide text-[var(--jf-accent)] uppercase">
                        From your resume
                      </p>
                      <p className="mt-1 text-xs whitespace-pre-wrap text-[var(--jf-fg)]">
                        {entry.next === '' ? '—' : entry.next}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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
          void deleteResume(target.id).then(refresh);
        }}
        title={`Delete ${pendingDelete?.name ?? 'this resume'}?`}
        description="The file and its cached extracted text are removed from this device. This cannot be undone."
        confirmLabel="Delete resume"
      />
    </div>
  );
}
