import {
  createElement as h,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * How a row reads to the user, not what the engine did to it.
 *
 *   filled     NextMove wrote the value and the page kept it.
 *   answered   NextMove recognised the field and wrote nothing, because it already had an answer.
 *   suggested  something is proposed but unproven — the user has to look.
 *   unmatched  nothing NextMove can do here; the field is the user's to complete.
 *
 * `answered` is its own tone because it is the only one of the four that is finished *and* not our
 * doing: counting it as `filled` inflates a number the header takes from the report, and counting
 * it as `unmatched` turns a deliberate, correct refusal into a red "Needs you" row.
 */
export type ReviewTone = 'filled' | 'answered' | 'suggested' | 'unmatched';

export interface ReviewRow {
  id: string;
  hash: string;
  tone: ReviewTone;
  label: string;
  section: string;
  path: string | null;
  value: string;
  score: number;
  required: boolean;
  reason?: string;
}

export interface UnreachableFrameNote {
  description: string;
  origin: string;
  reason: string;
}

export interface FrameContribution {
  origin: string;
  filled: number;
  suggested: number;
  skipped: number;
}

export interface NextStepInfo {
  kind: 'next' | 'submit';
  label: string;
}

export interface ReviewStats {
  filled: number;
  suggested: number;
  skipped: number;
  errors: number;
  total: number;
}

export interface ReviewPanelProps {
  atsLabel: string;
  domain: string;
  stats: ReviewStats;
  rows: readonly ReviewRow[];
  profilePaths: readonly string[];
  unreachableFrames: readonly UnreachableFrameNote[];
  frameContributions: readonly FrameContribution[];
  truncated: boolean;
  nextStep: NextStepInfo | null;
  busy: boolean;
  onRevealRow: (id: string) => void;
  onRevealNextStep: () => void;
  onMapField: (row: ReviewRow, path: string) => Promise<boolean>;
  onSaveAnswer?: (row: ReviewRow) => Promise<boolean>;
  focusedHash?: string | null;
  onRefill: () => void;
  onClose: () => void;
}

const TONE_LABEL: Readonly<Record<ReviewTone, string>> = {
  filled: 'Filled',
  answered: 'Already answered',
  suggested: 'Check these',
  unmatched: 'Needs you',
};

function reasonCopy(reason: string | undefined): string | null {
  switch (reason) {
    case undefined:
      return null;
    case 'new-field':
      return 'You’re on this field now — map it once and NextMove fills it here from then on.';
    case 'no-value':
      return 'Your profile has nothing for this field yet.';
    case 'no-option-match':
      return 'None of the options matched your saved answer.';
    case 'already-answered':
      // The engine's `REASON.alreadyAnswered`: a field that already carried an answer, so nothing
      // was written. Without this sentence the row looked like a failure the user had to fix.
      return 'You have already answered this — NextMove left it alone.';
    case 'value-not-committed':
    case 'commit-unverified':
      return 'Written, but the site did not confirm it — please check.';
    case 'listbox-timeout':
      return 'The site’s dropdown never opened; pick it yourself.';
    case 'no-resume':
      return 'Attach your resume here — NextMove cannot reach stored files from inside a page.';
    case 'submit-control':
      return 'This looked like a submit control, so NextMove left it alone.';
    case 'not-fillable':
      return 'This control disappeared before it could be filled.';
    case 'run-timeout':
      return 'The run hit its time limit before reaching this field.';
    case 'aborted':
      return 'Cancelled.';
    default:
      return null;
  }
}

function frameReasonCopy(reason: string): string {
  switch (reason) {
    case 'cross-origin':
      return 'a frame from another site';
    case 'sandboxed':
      return 'a sandboxed frame';
    case 'not-loaded':
      return 'a frame that had not loaded yet';
    default:
      return 'a frame we could not read';
  }
}

export function prettyPath(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, ' $1')
    .split('.')
    .map((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase())
        .trim(),
    )
    .filter((part) => part.length > 0)
    .join(' · ');
}

interface FieldMapperProps {
  row: ReviewRow;
  paths: readonly string[];
  domain: string;
  onMapField: (row: ReviewRow, path: string) => Promise<boolean>;
}

function FieldMapper({ row, paths, domain, onMapField }: FieldMapperProps): ReactElement {
  const [choice, setChoice] = useState<string>(row.path ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const save = useCallback(() => {
    if (choice.length === 0 || state === 'saving') return;
    setState('saving');
    void onMapField(row, choice).then(
      (ok) => setState(ok ? 'saved' : 'failed'),
      () => setState('failed'),
    );
  }, [choice, onMapField, row, state]);

  if (state === 'saved') {
    return h(
      'div',
      { className: 'jf-map jf-muted' },
      `Saved — NextMove will fill this field on ${domain} from now on.`,
    );
  }

  return h(
    'div',
    { className: 'jf-map' },
    h(
      'select',
      {
        value: choice,
        'aria-label': `Map “${row.label}” to a profile field`,
        onChange: (event: { currentTarget: { value: string } }) => {
          setChoice(event.currentTarget.value);
          setState('idle');
        },
      },
      h('option', { key: '', value: '' }, 'Map this field to…'),
      paths.map((path) => h('option', { key: path, value: path }, prettyPath(path))),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'jf-btn jf-btn--tiny jf-btn--primary',
        disabled: choice.length === 0 || state === 'saving',
        onClick: save,
      },
      state === 'saving' ? 'Saving…' : 'Remember',
    ),
    state === 'failed'
      ? h('span', { className: 'jf-row__meta' }, 'Could not save — try again.')
      : null,
  );
}

interface SaveAnswerButtonProps {
  row: ReviewRow;
  onSaveAnswer: (row: ReviewRow) => Promise<boolean>;
}

function SaveAnswerButton({ row, onSaveAnswer }: SaveAnswerButtonProps): ReactElement {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const save = useCallback(() => {
    if (state === 'saving') return;
    setState('saving');
    void onSaveAnswer(row).then(
      (ok) => setState(ok ? 'saved' : 'failed'),
      () => setState('failed'),
    );
  }, [onSaveAnswer, row, state]);

  if (state === 'saved') {
    return h(
      'div',
      { className: 'jf-map jf-muted' },
      'Saved to your Answer Bank — ✨ will offer it whenever this question appears again.',
    );
  }

  return h(
    'div',
    { className: 'jf-map' },
    h(
      'button',
      {
        type: 'button',
        className: 'jf-btn jf-btn--tiny',
        disabled: state === 'saving',
        onClick: save,
      },
      state === 'saving' ? 'Saving…' : 'Save what I typed as a reusable answer',
    ),
    state === 'failed'
      ? h('span', { className: 'jf-row__meta' }, 'Could not save — is the field empty?')
      : null,
  );
}

interface RowProps {
  row: ReviewRow;
  paths: readonly string[];
  domain: string;
  focused: boolean;
  onRevealRow: (id: string) => void;
  onMapField: (row: ReviewRow, path: string) => Promise<boolean>;
  onSaveAnswer?: (row: ReviewRow) => Promise<boolean>;
}

function Row({
  row,
  paths,
  domain,
  focused,
  onRevealRow,
  onMapField,
  onSaveAnswer,
}: RowProps): ReactElement {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const reason = reasonCopy(row.reason);
  const meta: string[] = [];
  if (row.path !== null) meta.push(prettyPath(row.path));
  if (row.section.length > 0) meta.push(row.section);

  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  return h(
    'div',
    { ref: rowRef, className: `jf-row jf-row--${row.tone}${focused ? ' jf-row--focused' : ''}` },
    h('span', { className: 'jf-row__bar' }),
    h(
      'div',
      { className: 'jf-row__main' },
      h(
        'div',
        { className: 'jf-row__label' },
        row.label.length > 0 ? row.label : 'Unlabelled field',
        row.required ? h('span', { className: 'jf-subtle' }, ' *') : null,
      ),
      meta.length > 0 ? h('div', { className: 'jf-row__meta' }, meta.join(' · ')) : null,
      row.value.length > 0 ? h('div', { className: 'jf-row__value' }, `→ ${row.value}`) : null,
      reason === null ? null : h('div', { className: 'jf-row__meta' }, reason),
      row.tone === 'unmatched' || focused
        ? h(FieldMapper, { row, paths, domain, onMapField })
        : null,
      // An already-answered field is the BEST candidate for this: the value sitting in it is one
      // the user typed themselves, so offering to bank it is worth more here than on a field
      // nothing could be matched to. Remapping stays hidden for those rows — the matcher already
      // resolved them — but banking the answer must not be gated behind focusing the page field.
      (row.tone === 'unmatched' || row.tone === 'answered' || focused) && onSaveAnswer !== undefined
        ? h(SaveAnswerButton, { row, onSaveAnswer })
        : null,

    ),
    h(
      'div',
      { className: 'jf-row__side' },
      h(
        'button',
        {
          type: 'button',
          className: 'jf-btn jf-btn--ghost jf-btn--tiny',
          onClick: () => onRevealRow(row.id),
          title: 'Scroll to this field',
        },
        'Show',
      ),
      row.score > 0
        ? h('span', { className: 'jf-row__score', title: 'Match confidence (SEC 6.3)' }, String(Math.round(row.score)))
        : null,
    ),
  );
}

export function ReviewPanel(props: ReviewPanelProps): ReactElement {
  const {
    atsLabel,
    domain,
    stats,
    rows,
    profilePaths,
    unreachableFrames,
    frameContributions,
    truncated,
    nextStep,
    busy,
    onRevealRow,
    onRevealNextStep,
    onMapField,
    onSaveAnswer,
    focusedHash,
    onRefill,
    onClose,
  } = props;

  const [active, setActive] = useState<ReviewTone | null>(null);

  const counts = useMemo(() => {
    const out: Record<ReviewTone, number> = { filled: 0, answered: 0, suggested: 0, unmatched: 0 };
    for (const row of rows) out[row.tone] += 1;
    return out;
  }, [rows]);

  const visible = useMemo(
    () => (active === null ? rows : rows.filter((row) => row.tone === active)),
    [rows, active],
  );

  const frameFilled = frameContributions.reduce((sum, frame) => sum + frame.filled, 0);

  const legend = (['filled', 'answered', 'suggested', 'unmatched'] as const).map((tone) =>
    h(
      'button',
      {
        key: tone,
        type: 'button',
        className: `jf-chip jf-chip--${tone}`,
        'aria-pressed': active === tone,
        onClick: () => setActive((current) => (current === tone ? null : tone)),
        title: active === tone ? 'Show everything' : `Show only ${TONE_LABEL[tone].toLowerCase()}`,
      },
      h('span', { className: 'jf-chip__swatch' }),
      `${TONE_LABEL[tone]} ${counts[tone]}`,
    ),
  );

  const notices: ReactNode[] = [];

  if (nextStep !== null) {
    notices.push(
      h(
        'div',
        { key: 'next', className: 'jf-callout jf-callout--next' },
        h(
          'div',
          { className: 'jf-callout__row' },
          h(
            'div',
            null,
            h('strong', null, 'Next step is here'),
            h(
              'div',
              { className: 'jf-panel__note' },
              nextStep.label.length > 0
                ? `“${nextStep.label}” — NextMove found it and will never press it. That part is yours.`
                : 'NextMove found the button that moves this application forward. Pressing it is yours.',
            ),
          ),
          h(
            'button',
            { type: 'button', className: 'jf-btn jf-btn--tiny', onClick: onRevealNextStep },
            'Show me',
          ),
        ),
      ),
    );
  }

  if (unreachableFrames.length > 0) {
    notices.push(
      h(
        'div',
        { key: 'frames', className: 'jf-callout' },
        h('strong', null, 'Part of this page is out of reach'),
        h(
          'div',
          null,
          frameContributions.length > 0
            ? `NextMove could not read into ${unreachableFrames.length} embedded ${
                unreachableFrames.length === 1 ? 'frame' : 'frames'
              } from here, though ${frameFilled} field${frameFilled === 1 ? '' : 's'} did get filled inside embedded frames by NextMove’s own copy running there.`
            : `This form is partly inside ${unreachableFrames.length === 1 ? 'a frame' : 'frames'} NextMove cannot read from this page. Use the toolbar button or Alt+J so every frame fills its own fields.`,
        ),
        h(
          'ul',
          null,
          unreachableFrames.slice(0, 4).map((frame, index) =>
            h(
              'li',
              { key: `${frame.description}-${index}` },
              frame.description,
              frame.origin.length > 0 ? ` — ${frame.origin}` : '',
              ` (${frameReasonCopy(frame.reason)})`,
            ),
          ),
        ),
      ),
    );
  }

  if (frameContributions.length > 0 && unreachableFrames.length === 0) {
    notices.push(
      h(
        'div',
        { key: 'contrib', className: 'jf-callout' },
        h('strong', null, 'Embedded frames'),
        h(
          'div',
          null,
          `${frameContributions.length} embedded ${
            frameContributions.length === 1 ? 'frame' : 'frames'
          } reported ${frameFilled} filled field${frameFilled === 1 ? '' : 's'}; they are counted in the totals above.`,
        ),
      ),
    );
  }

  if (truncated) {
    notices.push(
      h(
        'div',
        { key: 'truncated', className: 'jf-callout' },
        h('strong', null, 'This page is unusually large'),
        h(
          'div',
          null,
          'NextMove stopped scanning after its field limit, so the list below may not be the whole form. Scroll through the page before submitting.',
        ),
      ),
    );
  }

  return h(
    'div',
    { className: 'jf-card jf-panel', role: 'dialog', 'aria-label': 'NextMove review' },
    h(
      'div',
      { className: 'jf-panel__head' },
      h(
        'div',
        { style: { minWidth: 0, flex: 1 } },
        h(
          'div',
          { className: 'jf-panel__title' },
          stats.total === 0
            ? 'Nothing to fill on this page'
            : `Filled ${stats.filled} of ${stats.total} field${stats.total === 1 ? '' : 's'}`,
        ),
        h(
          'div',
          { className: 'jf-panel__sub' },
          // `stats.skipped` counts every field the engine did not write, which since the
          // already-answered policy includes the ones it deliberately respected. Calling those
          // "left for you" contradicts the legend directly below, which counts them as answered —
          // so they are named here instead of being blamed on the user.
          `${atsLabel} · ${stats.suggested} to check · ${Math.max(
            0,
            stats.skipped - counts.answered,
          )} left for you${counts.answered > 0 ? ` · ${counts.answered} already answered` : ''}${
            stats.errors > 0 ? ` · ${stats.errors} failed` : ''
          }`,

        ),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'jf-btn jf-btn--ghost jf-btn--tiny',
          onClick: onClose,
          'aria-label': 'Close review',
          title: 'Close',
        },
        '✕',
      ),
    ),

    h('div', { className: 'jf-legend' }, legend),

    h(
      'div',
      { className: 'jf-panel__body' },
      notices,
      visible.length === 0
        ? h(
            'div',
            { className: 'jf-panel__note', style: { padding: '10px 0' } },
            active === null
              ? 'No form fields were detected here.'
              : `Nothing in “${TONE_LABEL[active]}”.`,
          )
        : visible.map((row) =>
            h(Row, {
              key: row.id,
              row,
              paths: profilePaths,
              domain,
              focused: focusedHash != null && row.hash === focusedHash,
              onRevealRow,
              onMapField,
              onSaveAnswer,
            }),
          ),
    ),

    h(
      'div',
      { className: 'jf-panel__foot' },
      h(
        'div',
        { className: 'jf-panel__note' },
        'This was filled by NextMove — review before you submit. NextMove never presses Submit.',
      ),
      h(
        'div',
        { className: 'jf-panel__actions' },
        h(
          'button',
          { type: 'button', className: 'jf-btn', onClick: onRefill, disabled: busy },
          busy ? h('span', { className: 'jf-spinner' }) : null,
          busy ? 'Filling…' : 'Fill again',
        ),
        h('button', { type: 'button', className: 'jf-btn jf-btn--primary', onClick: onClose }, 'Done'),
      ),
    ),
  );
}
