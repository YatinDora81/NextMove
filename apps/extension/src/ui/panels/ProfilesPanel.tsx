import { useState } from 'react';
import type { ReactElement } from 'react';

import type { Profile } from '@/shared/types';

import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  Field,
  Input,
  Meter,
  Modal,
  Notice,
  PanelHeader,
  Select,
  toast,
} from '@/ui/components';
import { computeCompleteness } from '@/ui/completeness';
import { formatRelative } from '@/ui/format';
import { useProfilesStore } from '@/ui/store';

export function ProfilesPanel({ onEdit }: { onEdit: () => void }): ReactElement {
  const profiles = useProfilesStore((state) => state.profiles);
  const activeProfileId = useProfilesStore((state) => state.activeProfileId);
  const setActive = useProfilesStore((state) => state.setActive);
  const setEditing = useProfilesStore((state) => state.setEditing);
  const create = useProfilesStore((state) => state.create);
  const remove = useProfilesStore((state) => state.remove);
  const saving = useProfilesStore((state) => state.saving);

  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [baseId, setBaseId] = useState<string>('');
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);

  const openCreate = (): void => {
    setLabel('');
    setBaseId(activeProfileId ?? profiles[0]?.id ?? '');
    setCreating(true);
  };

  const submitCreate = async (): Promise<void> => {
    const name = label.trim();
    if (name === '') return;
    const base = profiles.find((profile) => profile.id === baseId) ?? null;
    const created = await create(name, base);
    setCreating(false);
    if (created === null) {
      toast.error('Could not create that profile.');
      return;
    }
    toast.ok(`“${created.label}” created${base === null ? '' : ' from your base identity'}.`);
    onEdit();
  };

  const confirmDelete = async (): Promise<void> => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) return;
    await remove(target.id);
    toast.ok(`“${target.label}” deleted.`);
  };

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Profiles"
        description="One vault, several angles. A “Frontend” profile and a “Fullstack” profile share your name, address and history — they differ in the summary, the skills you lead with, and the resume they attach."
        actions={
          <Button variant="primary" onClick={openCreate}>
            New profile
          </Button>
        }
      />

      {profiles.length === 0 ? (
        <EmptyState
          title="No profiles yet"
          description="Create one by hand, or upload a resume and let Gemini draft the first one."
          action={
            <Button variant="primary" onClick={openCreate}>
              Create a profile
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {profiles.map((profile) => {
            const active = profile.id === activeProfileId;
            const completeness = computeCompleteness(profile);
            return (
              <Card as="li" key={profile.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-[var(--jf-fg)]">
                        {profile.label === '' ? 'Untitled profile' : profile.label}
                      </h2>
                      {active ? <Badge tone="accent">Active</Badge> : null}
                      {profile.isDefault ? <Badge tone="neutral">Default</Badge> : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--jf-fg-muted)]">
                      {profile.personal.firstName || profile.personal.lastName
                        ? `${profile.personal.firstName} ${profile.personal.lastName}`.trim()
                        : 'No name yet'}
                      {profile.personal.email === '' ? '' : ` · ${profile.personal.email}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-[var(--jf-fg-subtle)]">
                    {formatRelative(profile.updatedAt)}
                  </span>
                </div>

                <Meter value={completeness.score} label="Complete" />

                {profile.skills.length === 0 ? null : (
                  <p className="truncate text-xs text-[var(--jf-fg-muted)]">
                    {profile.skills.slice(0, 8).join(' · ')}
                    {profile.skills.length > 8 ? ` +${profile.skills.length - 8}` : ''}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={active}
                    onClick={() => {
                      void setActive(profile.id);
                    }}
                  >
                    {active ? 'Active for fills' : 'Use for fills'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(profile.id);
                      onEdit();
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setLabel(`${profile.label} copy`);
                      setBaseId(profile.id);
                      setCreating(true);
                    }}
                  >
                    Duplicate
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    className="ml-auto"
                    disabled={profiles.length === 1}
                    title={
                      profiles.length === 1
                        ? 'This is your only profile — NextMove needs one to fill anything.'
                        : undefined
                    }
                    onClick={() => setPendingDelete(profile)}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      <Notice tone="info">
        Switching the active profile changes what a one-click fill uses. It never rewrites anything
        already filled or already logged in the tracker.
      </Notice>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New profile"
        description="Start from an existing profile to keep your name, contact details, history and authorization answers in sync."
        width="sm"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              busy={saving}
              disabled={label.trim() === ''}
              onClick={() => {
                void submitCreate();
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Profile name" hint="Shown in the popup switcher.">
            {(props) => (
              <Input
                {...props}
                autoFocus
                value={label}
                placeholder="Fullstack"
                onChange={(event) => setLabel(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  void submitCreate();
                }}
              />
            )}
          </Field>
          <Field
            label="Base identity"
            hint="Personal details, address, links, work history, education, authorization, EEO and compensation are copied. Summary and skills are yours to change."
          >
            {(props) => (
              <Select {...props} value={baseId} onChange={(event) => setBaseId(event.currentTarget.value)}>
                <option value="">Start from a blank profile</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label === '' ? 'Untitled profile' : profile.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Modal>

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          void confirmDelete();
        }}
        title={`Delete “${pendingDelete?.label ?? ''}”?`}
        description="The profile and its answers are removed from this device. Tracker rows and banked answers that reference it are kept."
        confirmLabel="Delete profile"
      />
    </div>
  );
}
