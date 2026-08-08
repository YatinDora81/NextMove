import {
  createElement as h,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export type ReviewTone = 'filled' | 'suggested' | 'unmatched';

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
  onRefill: () => void;
  onClose: () => void;
}

const TONE_LABEL: Readonly<Record<ReviewTone, string>> = {
  filled: 'Filled',
  suggested: 'Check these',
  unmatched: 'Needs you',
};

function reasonCopy(reason: string | undefined): string | null {
  switch (reason) {
    case undefined:
      return null;
    case 'no-value':
      return 'Your profile has nothing for this field yet.';
    case 'no-option-match':
      return 'None of the options matched your saved answer.';
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

interface RowProps {
  row: ReviewRow;
  paths: readonly string[];
  domain: string;
  onRevealRow: (id: string) => void;
  onMapField: (row: ReviewRow, path: string) => Promise<boolean>;
}

function Row({ row, paths, domain, onRevealRow, onMapField }: RowProps): ReactElement {
  const reason = reasonCopy(row.reason);
  const meta: string[] = [];
  if (row.path !== null) meta.push(prettyPath(row.path));
  if (row.section.length > 0) meta.push(row.section);

  return h(
    'div',
    { className: `jf-row jf-row--${row.tone}` },
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
      row.tone === 'unmatched'
        ? h(FieldMapper, { row, paths, domain, onMapField })
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
    onRefill,
    onClose,
  } = props;

  const [active, setActive] = useState<ReviewTone | null>(null);

  const counts = useMemo(() => {
    const out: Record<ReviewTone, number> = { filled: 0, suggested: 0, unmatched: 0 };
    for (const row of rows) out[row.tone] += 1;
    return out;
  }, [rows]);

  const visible = useMemo(
    () => (active === null ? rows : rows.filter((row) => row.tone === active)),
    [rows, active],
  );

  const frameFilled = frameContributions.reduce((sum, frame) => sum + frame.filled, 0);

  const legend = (['filled', 'suggested', 'unmatched'] as const).map((tone) =>
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
          `${atsLabel} · ${stats.suggested} to check · ${stats.skipped} left for you${
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
            h(Row, { key: row.id, row, paths: profilePaths, domain, onRevealRow, onMapField }),
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
