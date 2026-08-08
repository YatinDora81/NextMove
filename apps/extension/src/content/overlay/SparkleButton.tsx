import {
  createElement as h,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { MAX_QUESTION_CHARS } from '@/shared/constants';
import { sendMessage } from '@/platform/bus';
import type {
  AnswerHit,
  AnswerLength,
  AnswerSource,
  AnswerTone,
  FieldNode,
  JobContext,
} from '@/shared/types';

import { toastFromBusError, successToast, type ToastSpec } from './Toast';

const QUESTION_WORDS =
  /\b(why|how|what|describe|tell us|explain|share|elaborate|walk us|in your own words|motivat|interest(ed)? in|excites?|challenge|strength|weakness|proud|accomplish)\b/i;

const NOT_A_QUESTION =
  /\b(address|street|city|state|province|zip|postal|phone|email|linkedin|github|portfolio|website|url|salary|compensation|notice period|start date|referr?al|how did you hear)\b/i;

const MIN_TEXTAREA_QUESTION_CHARS = 8;
const MIN_INPUT_QUESTION_CHARS = 16;

export function isOpenTextQuestion(node: FieldNode): boolean {
  const sig = node.sig;
  if (!node.visible) return false;

  const text = `${sig.label} ${sig.placeholder} ${sig.ariaLabel}`.trim();
  if (text.length === 0) return false;
  if (NOT_A_QUESTION.test(text)) return false;
  if (sig.autocomplete.length > 0 && sig.autocomplete !== 'off') return false;

  if (sig.inputType === 'textarea') return text.length >= MIN_TEXTAREA_QUESTION_CHARS;

  if (sig.inputType === 'text') {
    if (text.length < MIN_INPUT_QUESTION_CHARS) return false;
    return text.trimEnd().endsWith('?') || QUESTION_WORDS.test(text);
  }

  return false;
}

export function questionOf(node: FieldNode): string {
  const sig = node.sig;
  const candidate = [sig.label, sig.ariaLabel, sig.placeholder].find(
    (value) => value.trim().length > 0,
  );
  return (candidate ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS);
}

export interface SparkleTarget {
  id: string;
  el: HTMLElement;
  question: string;
}

export interface SparkleContext {
  job: JobContext;
  profileId: string | null;
  tone: AnswerTone;
  length: AnswerLength;
  reuseBanked: boolean;
  aiAvailable: boolean;
  keyCount: number;
  pushToast: (spec: ToastSpec) => void;
  writeValue: (el: HTMLElement, text: string) => Promise<boolean>;
  readValue: (el: HTMLElement) => string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'looking' }
  | { kind: 'offer'; hit: AnswerHit }
  | { kind: 'generating' }
  | {
      kind: 'draft';
      text: string;
      origin: 'ai' | 'bank' | 'user';
      baseline: string;
      bankSource: AnswerSource | null;
    };

const ANCHOR_INTERVAL_MS = 500;

function useAnchorRect(el: Element | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (el === null) {
      setRect(null);
      return;
    }

    let disposed = false;

    const measure = (): void => {
      frame.current = null;
      if (disposed) return;
      if (!el.isConnected) {
        setRect(null);
        return;
      }
      let next: DOMRect | null = null;
      try {
        next = el.getBoundingClientRect();
      } catch {
        next = null;
      }
      setRect((current) => {
        if (next === null) return null;
        if (
          current !== null &&
          current.top === next.top &&
          current.left === next.left &&
          current.width === next.width &&
          current.height === next.height
        ) {
          return current;
        }
        return next;
      });
    };

    const schedule = (): void => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule, { passive: true });
    const timer = setInterval(schedule, ANCHOR_INTERVAL_MS);

    return () => {
      disposed = true;
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      clearInterval(timer);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [el]);

  return rect;
}

function onScreen(rect: DOMRect): boolean {
  return (
    rect.bottom > 4 &&
    rect.top < window.innerHeight - 4 &&
    rect.right > 4 &&
    rect.left < window.innerWidth - 4 &&
    (rect.width > 0 || rect.height > 0)
  );
}

const PANEL_WIDTH = 420;
const PANEL_ESTIMATED_HEIGHT = 340;

function panelPosition(rect: DOMRect): { top: number; left: number } {
  const below = rect.bottom + 8;
  const fitsBelow = below + PANEL_ESTIMATED_HEIGHT < window.innerHeight;
  const top = fitsBelow ? below : Math.max(8, rect.top - PANEL_ESTIMATED_HEIGHT - 8);
  const maxLeft = Math.max(8, window.innerWidth - PANEL_WIDTH - 8);
  const left = Math.min(Math.max(8, rect.left), maxLeft);
  return { top, left };
}

async function mintGesture(reason: string): Promise<string | null> {
  const reply = await sendMessage('GESTURE_MINT', { reason });
  return reply.ok ? reply.data.gesture : null;
}

export interface SparkleButtonProps {
  target: SparkleTarget;
  ctx: SparkleContext;
}

export function SparkleButton({ target, ctx }: SparkleButtonProps): ReactElement | null {
  const rect = useAnchorRect(target.el);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const close = useCallback(() => setPhase({ kind: 'idle' }), []);

  const generate = useCallback(
    async (gesture: string | null): Promise<void> => {
      const token = gesture ?? (await mintGesture('screening-answer'));
      if (token === null) {
        ctx.pushToast({
          id: `spark-gesture-${target.id}`,
          kind: 'info',
          title: 'Click ✨ again',
          message: 'NextMove needs a fresh click before it will spend one of your keys.',
          timeoutMs: 6_000,
        });
        if (alive.current) setPhase({ kind: 'idle' });
        return;
      }

      if (alive.current) setPhase({ kind: 'generating' });

      const reply = await sendMessage(
        'AI_GENERATE_ANSWER',
        {
          question: target.question,
          jobCtx: ctx.job,
          tone: ctx.tone,
          length: ctx.length,
          profileId: ctx.profileId,
        },
        token,
      );

      if (!alive.current) return;

      if (!reply.ok) {
        ctx.pushToast(
          toastFromBusError(reply.error, {
            keyCount: ctx.keyCount,
            onRetry: () => {
              void mintGesture('screening-answer-retry').then((next) => void generate(next));
            },
          }),
        );
        setPhase({ kind: 'idle' });
        return;
      }

      setPhase({
        kind: 'draft',
        text: reply.data.text,
        origin: 'ai',
        baseline: reply.data.text,
        bankSource: null,
      });
    },
    [ctx, target.id, target.question],
  );

  const onSparkle = useCallback(() => {
    if (phase.kind !== 'idle') {
      close();
      return;
    }

    const gesturePromise = mintGesture('screening-answer');

    if (!ctx.reuseBanked) {
      void gesturePromise.then((token) => void generate(token));
      return;
    }

    setPhase({ kind: 'looking' });

    void sendMessage('ANSWERS_LOOKUP', {
      qRaw: target.question,
      company: ctx.job.company.length > 0 ? ctx.job.company : null,
      profileId: ctx.profileId,
    }).then(
      (reply) => {
        if (!alive.current) return;
        if (reply.ok && reply.data.hit !== null) {
          setPhase({ kind: 'offer', hit: reply.data.hit });
          return;
        }
        void gesturePromise.then((token) => void generate(token));
      },
      () => {
        if (!alive.current) return;
        void gesturePromise.then((token) => void generate(token));
      },
    );
  }, [close, ctx, generate, phase.kind, target.question]);

  const provenanceOf = useCallback(
    (origin: 'ai' | 'bank' | 'user', edited: boolean, bankSource: AnswerSource | null): AnswerSource => {
      if (origin === 'user') return 'user';
      if (origin === 'ai') return edited ? 'ai-edited' : 'ai';
      const previous = bankSource ?? 'user';
      if (!edited) return previous;
      return previous === 'user' ? 'user' : 'ai-edited';
    },
    [],
  );

  const accept = useCallback(
    async (text: string, source: AnswerSource): Promise<void> => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      const written = await ctx.writeValue(target.el, trimmed);
      if (!written) {
        ctx.pushToast({
          id: `spark-write-${target.id}`,
          kind: 'error',
          title: 'Could not type into that field',
          message: 'Copy the answer from the panel and paste it in yourself.',
          timeoutMs: 9_000,
        });
        return;
      }

      const saved = await sendMessage('ANSWERS_SAVE', {
        qRaw: target.question,
        answer: trimmed,
        source,
        profileId: ctx.profileId,
        company: ctx.job.company.length > 0 ? ctx.job.company : null,
      });

      if (!alive.current) return;
      close();
      ctx.pushToast(
        successToast(
          source === 'ai' || source === 'ai-edited'
            ? 'AI draft inserted — review before submitting'
            : 'Answer inserted',
          saved.ok
            ? 'Saved to your Answer Bank, so the next application reuses it for free.'
            : 'Inserted into the form (it could not be added to your Answer Bank).',
        ),
      );
    },
    [close, ctx, target.el, target.id, target.question],
  );

  if (rect === null || !onScreen(rect)) return null;

  const busy = phase.kind === 'looking' || phase.kind === 'generating';

  const button = h(
    'button',
    {
      type: 'button',
      className: 'jf-spark',
      style: {
        top: `${rect.top}px`,
        left: `${rect.right}px`,
        transform: rect.top < 34 ? 'translate(-100%, 6%)' : 'translate(-100%, -118%)',
      },
      disabled: busy,
      onClick: onSparkle,
      title:
        phase.kind === 'idle'
          ? 'Answer this with NextMove — checks your saved answers first'
          : 'Close',
      'aria-label': 'Answer this question with NextMove',
    },
    busy ? h('span', { className: 'jf-spinner' }) : h('span', { className: 'jf-spark__icon' }, '✨'),
    busy ? (phase.kind === 'looking' ? 'Checking your answers…' : 'Writing…') : 'Answer',
  );

  const panel =
    phase.kind === 'offer' || phase.kind === 'draft'
      ? h(AnswerPanel, {
          phase,
          rect,
          target,
          ctx,
          onClose: close,
          onUseSaved: (hit: AnswerHit) => void accept(hit.answer, hit.record.source),
          onEditSaved: (hit: AnswerHit) =>
            setPhase({
              kind: 'draft',
              text: hit.answer,
              origin: 'bank',
              baseline: hit.answer,
              bankSource: hit.record.source,
            }),
          onRegenerate: () => {
            void mintGesture('screening-answer-regenerate').then((token) => void generate(token));
          },
          onAccept: (text: string, origin: 'ai' | 'bank' | 'user', baseline: string, bankSource: AnswerSource | null) =>
            void accept(text, provenanceOf(origin, text.trim() !== baseline.trim(), bankSource)),
          onChange: (text: string) =>
            setPhase((current) => (current.kind === 'draft' ? { ...current, text } : current)),
        })
      : null;

  return h('div', null, button, panel);
}

interface AnswerPanelProps {
  phase: Extract<Phase, { kind: 'offer' } | { kind: 'draft' }>;
  rect: DOMRect;
  target: SparkleTarget;
  ctx: SparkleContext;
  onClose: () => void;
  onUseSaved: (hit: AnswerHit) => void;
  onEditSaved: (hit: AnswerHit) => void;
  onRegenerate: () => void;
  onAccept: (
    text: string,
    origin: 'ai' | 'bank' | 'user',
    baseline: string,
    bankSource: AnswerSource | null,
  ) => void;
  onChange: (text: string) => void;
}

function AnswerPanel(props: AnswerPanelProps): ReactElement {
  const { phase, rect, target, ctx, onClose, onUseSaved, onEditSaved, onRegenerate, onAccept, onChange } =
    props;
  const position = panelPosition(rect);

  const header = h(
    'div',
    { className: 'jf-answer__head' },
    h(
      'div',
      { style: { minWidth: 0, flex: 1 } },
      h(
        'div',
        { className: 'jf-answer__title' },
        phase.kind === 'offer'
          ? phase.hit.kind === 'same'
            ? 'You’ve answered this before'
            : 'You’ve answered something similar'
          : phase.origin === 'ai'
            ? 'AI draft'
            : 'Your saved answer',
      ),
      h('div', { className: 'jf-answer__q' }, target.question),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'jf-btn jf-btn--ghost jf-btn--tiny',
        onClick: onClose,
        'aria-label': 'Close',
        title: 'Close',
      },
      '✕',
    ),
  );

  const noKeysHint = ctx.aiAvailable
    ? null
    : h(
        'span',
        { className: 'jf-row__meta' },
        'Add a free Gemini key in Options to generate new answers.',
      );

  if (phase.kind === 'offer') {
    const hit = phase.hit;
    const similarity = `${Math.round(hit.similarity * 100)}% match`;

    const body =
      hit.kind === 'same'
        ? h(
            'div',
            null,
            h(
              'div',
              { style: { marginBottom: '8px' } },
              h('span', { className: 'jf-tag jf-tag--saved' }, 'From your Answer Bank'),
              ' ',
              h('span', { className: 'jf-row__meta' }, `${similarity} · used ${hit.record.timesUsed}×`),
            ),
            h('div', { className: 'jf-preview' }, hit.answer),
          )
        : h(
            'div',
            null,
            h(
              'div',
              { style: { marginBottom: '8px' } },
              h('span', { className: 'jf-tag jf-tag--similar' }, `Similar question · ${similarity}`),
            ),
            h(
              'div',
              { className: 'jf-compare' },
              h(
                'div',
                { className: 'jf-compare__col' },
                h('div', { className: 'jf-compare__head' }, 'This form asks'),
                h('div', { className: 'jf-compare__text' }, target.question),
              ),
              h(
                'div',
                { className: 'jf-compare__col' },
                h('div', { className: 'jf-compare__head' }, 'You answered'),
                h('div', { className: 'jf-compare__text' }, hit.record.qRaw),
              ),
            ),
            h('div', { className: 'jf-preview', style: { marginTop: '8px' } }, hit.answer),
          );

    return h(
      'div',
      {
        className: 'jf-card jf-answer',
        style: { top: `${position.top}px`, left: `${position.left}px` },
        role: 'dialog',
        'aria-label': 'Saved answer',
      },
      header,
      h('div', { className: 'jf-answer__body' }, body),
      h(
        'div',
        { className: 'jf-answer__foot' },
        h(
          'button',
          { type: 'button', className: 'jf-btn jf-btn--primary', onClick: () => onUseSaved(hit) },
          'Use saved',
        ),
        h(
          'button',
          { type: 'button', className: 'jf-btn', onClick: () => onEditSaved(hit) },
          'Edit saved',
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'jf-btn',
            onClick: onRegenerate,
            disabled: !ctx.aiAvailable,
            title: ctx.aiAvailable ? 'Spends one request from your own key pool' : undefined,
          },
          'Regenerate with AI',
        ),
        noKeysHint,
      ),
    );
  }

  const edited = phase.text.trim() !== phase.baseline.trim();
  const existing = ctx.readValue(target.el).trim();

  const footer: ReactNode[] = [
    h(
      'button',
      {
        key: 'insert',
        type: 'button',
        className: 'jf-btn jf-btn--primary',
        disabled: phase.text.trim().length === 0,
        onClick: () => onAccept(phase.text, phase.origin, phase.baseline, phase.bankSource),
      },
      'Insert into form',
    ),
    h(
      'button',
      {
        key: 'regen',
        type: 'button',
        className: 'jf-btn',
        onClick: onRegenerate,
        disabled: !ctx.aiAvailable,
      },
      'Regenerate',
    ),
    h('button', { key: 'cancel', type: 'button', className: 'jf-btn jf-btn--ghost', onClick: onClose }, 'Cancel'),
  ];

  if (existing.length > 0 && existing !== phase.text.trim()) {
    footer.push(
      h(
        'button',
        {
          key: 'mine',
          type: 'button',
          className: 'jf-btn jf-btn--ghost jf-btn--tiny',
          title: 'Bank the answer already in the field, in your own words',
          onClick: () => onAccept(existing, 'user', '', null),
        },
        'Save what I wrote',
      ),
    );
  }

  if (!ctx.aiAvailable) footer.push(noKeysHint);

  return h(
    'div',
    {
      className: 'jf-card jf-answer',
      style: { top: `${position.top}px`, left: `${position.left}px` },
      role: 'dialog',
      'aria-label': 'Draft answer',
    },
    header,
    h(
      'div',
      { className: 'jf-answer__body' },
      h(
        'div',
        { style: { marginBottom: '8px' } },
        phase.origin === 'ai'
          ? h('span', { className: 'jf-tag jf-tag--ai' }, 'AI draft — review before submitting')
          : h('span', { className: 'jf-tag jf-tag--saved' }, 'From your Answer Bank'),
        edited ? h('span', { className: 'jf-row__meta' }, ' · edited') : null,
      ),
      h('textarea', {
        value: phase.text,
        rows: 7,
        spellCheck: true,
        'aria-label': 'Draft answer',
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value),
      }),
      h(
        'div',
        { className: 'jf-row__meta', style: { marginTop: '6px' } },
        `${phase.text.trim().split(/\s+/).filter((word) => word.length > 0).length} words · nothing is submitted for you`,
      ),
    ),
    h('div', { className: 'jf-answer__foot' }, footer),
  );
}

export interface SparkleLayerProps {
  targets: readonly SparkleTarget[];
  ctx: SparkleContext;
}

export function SparkleLayer({ targets, ctx }: SparkleLayerProps): ReactElement | null {
  if (targets.length === 0) return null;
  return h(
    'div',
    null,
    targets.map((target) => h(SparkleButton, { key: target.id, target, ctx })),
  );
}
