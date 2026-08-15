import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { setEnabled, subscribeSlot } from '@/platform/storage';
import { DEFAULT_MODEL_CHAIN, FILL_THRESHOLD, SUGGEST_THRESHOLD } from '@/shared/constants';
import type { AnswerLength, AnswerTone, ModelId } from '@/shared/types';

import {
  Button,
  Field,
  FieldGrid,
  FieldSet,
  Input,
  Notice,
  PanelHeader,
  Select,
  Switch,
  toast,
} from '@/ui/components';
import { formatRelative } from '@/ui/format';
import { SHORTCUTS, openShortcutsPage, shortcutKeys, shortcutText } from '@/ui/shortcuts';
import { call, describeError, useSettingsStore } from '@/ui/store';

const TONES: readonly AnswerTone[] = ['concise', 'enthusiastic', 'formal'];
const LENGTHS: readonly AnswerLength[] = ['short', 'medium', 'long'];

export function PreferencesPanel(): ReactElement {
  const settings = useSettingsStore((state) => state.settings);
  const error = useSettingsStore((state) => state.error);
  const load = useSettingsStore((state) => state.load);
  const patch = useSettingsStore((state) => state.patch);

  const [configBusy, setConfigBusy] = useState(false);
  const [configInfo, setConfigInfo] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // This panel now carries the power switch, which is the same stored flag as Alt+Shift+N, the
    // popup's toggle and the in-page bubble. No surface may keep a private copy of it: without this
    // subscription, pressing the shortcut with Options open would leave a switch on screen claiming
    // the opposite of what is true.
    return subscribeSlot('settings', () => {
      void load();
    });
  }, [load]);

  if (settings === null) {
    return <p className="text-sm text-[var(--jf-fg-muted)]">Loading preferences…</p>;
  }

  const refreshConfig = async (): Promise<void> => {
    setConfigBusy(true);
    try {
      const data = await call('CONFIG_REFRESH', { force: true });
      setConfigInfo(
        data.updated
          ? `Updated to ${data.version} (${formatRelative(data.fetchedAt)}).`
          : `Already on the newest data (${data.version}).`,
      );
    } catch (caught) {
      setConfigInfo(`Could not reach the config CDN: ${describeError(caught)}. Shipped selectors are still in use.`);
    } finally {
      setConfigBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Preferences"
        description="How NextMove behaves when it fills a form, and what it defaults to when you ask it for an AI answer."
      />

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      <FieldSet
        legend="Keyboard"
        description="The shipped defaults. Your browser owns the bindings, so it is also where you change them."
        actions={
          <Button variant="secondary" size="sm" onClick={openShortcutsPage}>
            Change shortcuts
          </Button>
        }
      >
        <dl className="flex flex-col gap-1.5">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.id} className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-[var(--jf-fg-muted)]">{shortcut.label}</dt>
              <dd
                className="flex shrink-0 items-center gap-1"
                aria-label={shortcutText(shortcut)}
              >
                {shortcutKeys(shortcut).map((key) => (
                  <kbd
                    key={key}
                    className="rounded-[var(--jf-radius-sm)] border border-[var(--jf-kbd-border)] bg-[var(--jf-kbd-bg)] px-1.5 py-px font-[var(--jf-font-mono)] text-[12px] text-[var(--jf-fg-muted)]"
                  >
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </FieldSet>

      <FieldSet legend="Filling">
        <div className="flex flex-col gap-1">
          <Switch
            checked={settings.enabled}
            onChange={(enabled) => {
              // Through the shared writer, not this panel's generic `patch`: the power switch has one
              // implementation so that four surfaces cannot disagree about it (SEC 5.1).
              void setEnabled(enabled);
            }}
            label="NextMove is on"
            hint="Off means the in-page layer draws nothing, suggests nothing and fills nothing on any site — and the toolbar button, the shortcut and the context menu all refuse. Nothing you have saved is touched."
          />
          <Switch
            checked={settings.showFloatingPill}
            onChange={(showFloatingPill) => {
              void patch({ showFloatingPill });
            }}
            label="Show NextMove's button in the corner of a page"
            hint="The bubble that expands into the review panel, and the only place the on/off switch is reachable from inside a page."
          />
          <Switch
            checked={settings.autoFillOnLoad}
            onChange={(autoFillOnLoad) => {
              void patch({ autoFillOnLoad });
            }}
            label="Fill automatically when an application page loads"
            hint="Off by default. Even on, NextMove only fills — it never presses Submit or Next."
          />
          <Switch
            checked={settings.autoFillNextSteps}
            onChange={(autoFillNextSteps) => {
              void patch({ autoFillNextSteps });
            }}
            label="Keep filling as you move through multi-step applications"
            hint="After you fill once, each step you open gets filled automatically. You still press Next and Submit yourself."
          />
          <Switch
            checked={settings.highlightFilled}
            onChange={(highlightFilled) => {
              void patch({ highlightFilled });
            }}
            label="Outline every field NextMove touched"
            hint="Blue filled · yellow low confidence · red unmatched."
          />
          <Switch
            checked={settings.reviewOverlay}
            onChange={(reviewOverlay) => {
              void patch({ reviewOverlay });
            }}
            label="Show the review summary after a fill"
          />
          <Switch
            checked={settings.humanPacing}
            onChange={(humanPacing) => {
              void patch({ humanPacing });
            }}
            label="Type at a human pace"
            hint="Small jittered delays between fields. Slower, and far less likely to trip an ATS's bot heuristics."
          />
        </div>
      </FieldSet>

      <FieldSet
        legend="Confidence thresholds"
        description="NextMove scores every field before writing to it. Above the fill threshold it types; between the two it suggests; below the suggest threshold it skips and flags the field instead of guessing."
      >
        <FieldGrid cols={2}>
          <Field
            label={`Fill at or above (default ${FILL_THRESHOLD})`}
            hint="Lower this and NextMove fills more fields — and gets more of them wrong."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                max={100}
                value={settings.fillThreshold}
                onChange={(event) => {
                  const value = Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0));
                  void patch({ fillThreshold: value });
                }}
              />
            )}
          </Field>
          <Field
            label={`Suggest at or above (default ${SUGGEST_THRESHOLD})`}
            hint="Below this, a field is left blank and marked for you to map."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                max={100}
                value={settings.suggestThreshold}
                onChange={(event) => {
                  const value = Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0));
                  void patch({ suggestThreshold: value });
                }}
              />
            )}
          </Field>
        </FieldGrid>
        {settings.suggestThreshold >= settings.fillThreshold ? (
          <Notice tone="warn" className="mt-3">
            The suggest threshold is at or above the fill threshold, which leaves no gray zone.
            NextMove will fill or skip, never suggest.
          </Notice>
        ) : null}
      </FieldSet>

      <FieldSet
        legend="AI defaults"
        description="Used when you press Answer on a form. Nothing here causes a request on its own — every AI call still needs an explicit click."
      >
        <FieldGrid cols={3}>
          <Field label="Tone">
            {(props) => (
              <Select
                {...props}
                value={settings.tone}
                onChange={(event) => {
                  void patch({ tone: event.currentTarget.value as AnswerTone });
                }}
              >
                {TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone.charAt(0).toUpperCase() + tone.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Answer length">
            {(props) => (
              <Select
                {...props}
                value={settings.answerLength}
                onChange={(event) => {
                  void patch({ answerLength: event.currentTarget.value as AnswerLength });
                }}
              >
                {LENGTHS.map((length) => (
                  <option key={length} value={length}>
                    {length.charAt(0).toUpperCase() + length.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Preferred model" hint="NextMove degrades down the chain when a tier is spent.">
            {(props) => (
              <Select
                {...props}
                value={settings.preferredModel}
                onChange={(event) => {
                  void patch({ preferredModel: event.currentTarget.value as ModelId });
                }}
              >
                {DEFAULT_MODEL_CHAIN.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FieldGrid>
        <div className="mt-3">
          <Switch
            checked={settings.reuseBankedAnswers}
            onChange={(reuseBankedAnswers) => {
              void patch({ reuseBankedAnswers });
            }}
            label="Offer a banked answer before generating a new one"
            hint="Keep this on: a bank hit costs no API quota and keeps your voice consistent."
          />
        </div>
      </FieldSet>

      <FieldSet legend="Tracker">
        <div className="flex flex-col gap-1">
          <Switch
            checked={settings.autoLogApplications}
            onChange={(autoLogApplications) => {
              void patch({ autoLogApplications });
            }}
            label="Log every application NextMove fills"
          />
          <Switch
            checked={settings.autoCaptureJobContext}
            onChange={(autoCaptureJobContext) => {
              void patch({ autoCaptureJobContext });
            }}
            label="Capture the company and role from the posting"
            hint="Read from the page's own job-posting metadata. Both stay editable on the logged row."
          />
        </div>
      </FieldSet>

      <FieldSet
        legend="Adapter data"
        description="When an ATS changes its markup, NextMove ships a fix as versioned selector data rather than a new extension release. It is data, never code."
        actions={
          <Button
            busy={configBusy}
            onClick={() => {
              void refreshConfig();
            }}
          >
            Check for updates
          </Button>
        }
      >
        <Switch
          checked={settings.remoteConfigEnabled}
          onChange={(remoteConfigEnabled) => {
            void patch({ remoteConfigEnabled });
            toast.ok(
              remoteConfigEnabled
                ? 'NextMove will check for selector updates daily.'
                : 'Selector updates disabled — the versions shipped with this release stay in use.',
            );
          }}
          label="Check for selector updates daily"
          hint="Turn this off and NextMove uses only the selectors shipped in this release."
        />
        {configInfo === null ? null : (
          <p className="mt-2 text-xs text-[var(--jf-fg-muted)]">{configInfo}</p>
        )}
      </FieldSet>
    </div>
  );
}
