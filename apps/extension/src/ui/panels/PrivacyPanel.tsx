import { useState } from 'react';
import type { ReactElement } from 'react';

import { deleteDatabase } from '@/platform/db';
import { wipeInstall } from '@/platform/storage';
import { SCHEMA_VERSION } from '@/shared/constants';

import {
  Badge,
  Button,
  ConfirmModal,
  Notice,
  PanelHeader,
  Switch,
  toast,
} from '@/ui/components';
import { datedFilename, downloadJson } from '@/ui/download';
import {
  call,
  describeError,
  useAnswersStore,
  useMappingsStore,
  useProfilesStore,
  useSettingsStore,
} from '@/ui/store';

export const EXPORT_KIND = 'jobfill.export.v1';

export function PrivacyPanel(): ReactElement {
  const profiles = useProfilesStore((state) => state.profiles);
  const activeProfileId = useProfilesStore((state) => state.activeProfileId);
  const settings = useSettingsStore((state) => state.settings);
  const patchSettings = useSettingsStore((state) => state.patch);
  const mappings = useMappingsStore((state) => state.mappings);
  const loadMappings = useMappingsStore((state) => state.load);
  const loadAnswers = useAnswersStore((state) => state.load);

  const [exporting, setExporting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const onExport = async (): Promise<void> => {
    setExporting(true);
    try {
      await loadMappings();
      await loadAnswers();
      const [applications, answers] = await Promise.all([
        call('TRACKER_QUERY', {}),
        call('ANSWERS_LIST', {}),
      ]);

      downloadJson(datedFilename('jobfill-export', 'json'), {
        kind: EXPORT_KIND,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: Date.now(),
        profiles,
        activeProfileId,
        settings,
        mappings,
        applications: applications.rows,
        answers: answers.records,
      });
      toast.ok('Everything exported, minus your API keys.');
    } catch (caught) {
      toast.error(describeError(caught));
    } finally {
      setExporting(false);
    }
  };

  const onWipe = async (): Promise<void> => {
    setConfirmWipe(false);
    setWiping(true);
    try {
      await wipeInstall();
      await deleteDatabase();
      toast.ok('Everything on this device has been erased. Reloading…');
      window.setTimeout(() => window.location.reload(), 900);
    } catch (caught) {
      setWiping(false);
      toast.error(describeError(caught));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Privacy & data"
        description="NextMove is local-first by architecture, not by policy. Your profile, resumes, tracker and answers live in this browser; the only outbound traffic is to Google, with your own key, when you click something."
      />

      <div className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--jf-fg)]">What is stored, and how</h2>
        <ul className="mt-3 flex flex-col gap-3">
          <li className="flex flex-wrap items-start gap-3">
            <Badge tone="danger">Critical</Badge>
            <p className="min-w-56 flex-1 text-xs leading-relaxed text-[var(--jf-fg-muted)]">
              <span className="font-medium text-[var(--jf-fg)]">Gemini API keys.</span> Encrypted
              with AES-256-GCM at rest, decrypted only inside the service worker at the moment of a
              call, and dropped immediately after. Never displayed, never logged, never synced,
              never exported.
            </p>
          </li>
          <li className="flex flex-wrap items-start gap-3">
            <Badge tone="warn">Sensitive</Badge>
            <p className="min-w-56 flex-1 text-xs leading-relaxed text-[var(--jf-fg-muted)]">
              <span className="font-medium text-[var(--jf-fg)]">
                Profile, EEO answers, visa status, salary, resumes.
              </span>{' '}
              Encrypted at rest on this device. Leaves it only when you send resume text or a
              question to Gemini, or if you turn on sync — and then as ciphertext the server cannot
              read.
            </p>
          </li>
          <li className="flex flex-wrap items-start gap-3">
            <Badge tone="neutral">Internal</Badge>
            <p className="min-w-56 flex-1 text-xs leading-relaxed text-[var(--jf-fg-muted)]">
              <span className="font-medium text-[var(--jf-fg)]">
                Learned mappings, settings, tracker rows.
              </span>{' '}
              Local by default; synced only if you explicitly pair a device.
            </p>
          </li>
        </ul>

        <Notice tone="warn" className="mt-4" title="The honest limit of on-device encryption">
          The vault key is derived with PBKDF2 (210,000 iterations, SHA-256) from a random secret
          generated when you installed NextMove. That secret lives on this same device, so{' '}
          <strong>
            this defeats casual file-system snooping and backup leakage, not malware running as you.
          </strong>{' '}
          An optional passphrase mode upgrades it to real end-to-end strength, and is required
          before anything can be synced.
        </Notice>
      </div>

      <div className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--jf-fg)]">Permissions NextMove does not ask for</h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--jf-fg-muted)]">
          No browsing history. No cookies. No web-request interception. No bookmarks. The one broad
          permission is access to page content on any site — a career page can be anywhere, so a
          form filler has to be able to read the page you are on. NextMove activates only when a scan
          finds application-shaped fields and stores nothing about pages that are not applications.
        </p>
      </div>

      <div className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--jf-fg)]">Anonymous site-health reports</h2>
        <Switch
          className="mt-2"
          checked={settings?.telemetryOptIn === true}
          disabled={settings === null}
          onChange={(telemetryOptIn) => {
            void patchSettings({ telemetryOptIn });
            toast.ok(
              telemetryOptIn
                ? 'Thank you — anonymous fill-rate reports are on.'
                : 'Site-health reports are off.',
            );
          }}
          label="Send anonymous fill-rate reports"
          hint="Off by default and off unless you turn it on here."
        />
        <p className="mt-2 text-xs leading-relaxed text-[var(--jf-fg-muted)]">
          If enabled, a report contains four things: which ATS was detected, a one-way hash of the
          domain, what fraction of fields were filled, and the extension version. It contains no
          URLs, no field values, no personal data and nothing that identifies you. It exists so that
          &ldquo;Workday broke again&rdquo; reaches us before it reaches your inbox.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-[var(--jf-radius)] border border-[var(--jf-border)] bg-[var(--jf-surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--jf-fg)]">Export everything</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--jf-fg-muted)]">
            One JSON file containing your profiles, settings, learned mappings, tracker rows and
            Answer Bank. Resume files and API keys are not included — the files are large binaries,
            and the keys must never be written to disk in the clear.
          </p>
          <Button
            className="mt-3"
            busy={exporting}
            onClick={() => {
              void onExport();
            }}
          >
            Export JSON
          </Button>
        </div>

        <div className="rounded-[var(--jf-radius)] border border-[color-mix(in_srgb,var(--jf-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--jf-danger)_5%,transparent)] p-4">
          <h2 className="text-sm font-semibold text-[var(--jf-fg)]">Erase everything</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--jf-fg-muted)]">
            Deletes your profiles, settings, keys, mappings, resumes, tracker and Answer Bank from
            this device, along with the encryption material that protects them. There is no backup
            and no undo — export first if there is any doubt.
          </p>
          <Button
            variant="danger"
            className="mt-3"
            busy={wiping}
            onClick={() => setConfirmWipe(true)}
          >
            Erase all NextMove data
          </Button>
        </div>
      </div>

      <Notice tone="info">
        Single purpose, stated plainly: NextMove fills job application forms you are looking at. It
        never submits one for you, never scrapes at scale, never injects affiliate links and never
        loads remote code.
      </Notice>

      <ConfirmModal
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        onConfirm={() => {
          void onWipe();
        }}
        title="Erase everything on this device?"
        description="Profiles, resumes, API keys, tracker, answers and mappings. This cannot be undone."
        confirmLabel="Erase everything"
        confirmWord="ERASE"
        busy={wiping}
      />
    </div>
  );
}
