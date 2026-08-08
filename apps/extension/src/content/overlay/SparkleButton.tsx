/**
 * content/overlay/SparkleButton.tsx — F-09 AI screening answers, gated by F-17 Answer Memory.
 *
 * JF-001 Rev 3.0 · SEC 4.3 Flow B · SEC 5.7 · F-09 · F-17 · INV-2.
 *
 * The exact order of operations Flow B prescribes, implemented here:
 *
 *   1. The user clicks ✨. **This is the only entry point** (INV-2). The click handler mints a
 *      user-gesture nonce over `GESTURE_MINT` — the overlay is trusted extension UI, and the bus
 *      refuses `GESTURE_MINT` from anything that is not (see `platform/bus.ts`). The nonce is
 *      single-use with a 5 s TTL, so every later action (Regenerate) mints its own.
 *
 *   2. **Answer Memory first** (SEC 5.7). `ANSWERS_LOOKUP` is a fully OFFLINE read: no key lease,
 *      no network, no gesture required. A hit at ≥ SAME_Q shows the "You've answered this before"
 *      chip (Use saved · Edit saved · Regenerate with AI); a hit in the 0.75-0.92 band shows the
 *      side-by-side preview so the user can judge whether the older question really is the same
 *      one. Zero API spend on either path.
 *
 *   3. Only a miss, or an explicit **Regenerate**, sends `AI_GENERATE_ANSWER` — with the full
 *      context Flow B lists: the question, the job context scraped from the page (title, company,
 *      JD), the active profile, and the tone/length presets.
 *
 *   4. The draft is inserted carrying the **"AI draft — review before submitting"** chip, and
 *      whatever the user finally accepts is upserted to the bank with honest provenance:
 *      `ai` (accepted verbatim) · `ai-edited` (accepted after editing) · `user` (their own words).
 *
 * SEC 5.6 is respected on the failure side: `NO_KEYS`, `ALL_KEYS_BUSY` and `QUOTA_EXHAUSTED` come
 * back as bus errors and are rendered by `Toast` with the countdown / setup copy. With no keys at
 * all the ✨ still works — the Answer-Bank path is offline — but the AI actions render disabled
 * with the "Add a free Gemini key (2 min) →" hint.
 *
 * SEC 9.2: the question text, the company name and the answer are all page- or model-derived, and
 * are rendered as React text children (`textContent`). Nothing here builds markup from a string.
 *
 * No JSX — `apps/extension/tsconfig.json` sets no `jsx` factory, so this file uses `createElement`.
 */

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

/* ------------------------------------------------------------------------------------------------
 * Which fields get a ✨
 * ---------------------------------------------------------------------------------------------- */

/** Question-shaped wording that marks a short text input as an open-text screening question. */
const QUESTION_WORDS =
  /\b(why|how|what|describe|tell us|explain|share|elaborate|walk us|in your own words|motivat|interest(ed)? in|excites?|challenge|strength|weakness|proud|accomplish)\b/i;

/** Wording that means "this is a data field", even when it is long or ends in a question mark. */
const NOT_A_QUESTION =
  /\b(address|street|city|state|province|zip|postal|phone|email|linkedin|github|portfolio|website|url|salary|compensation|notice period|start date|referr?al|how did you hear)\b/i;

const MIN_TEXTAREA_QUESTION_CHARS = 8;
const MIN_INPUT_QUESTION_CHARS = 16;

/**
 * "✨ button injected beside detected open-text questions" (F-09).
 *
 * A `<textarea>` is an open-text answer box almost by definition; a single-line input only earns a
 * ✨ when its label actually reads like a question. Data fields are excluded outright so the
 * affordance never appears next to "Street address".
 */
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

/** The question we ask Gemini and key the bank on. Untrusted page text, clamped before it travels. */
export function questionOf(node: FieldNode): string {
  const sig = node.sig;
  const candidate = [sig.label, sig.ariaLabel, sig.placeholder].find(
    (value) => value.trim().length > 0,
  );
  return (candidate ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS);
}

/* ------------------------------------------------------------------------------------------------
 * Shapes
 * ---------------------------------------------------------------------------------------------- */

export interface SparkleTarget {
  /** Stable id (the field signature hash). */
  id: string;
  el: HTMLElement;
  /** Resolved question text. Untrusted page text. */
  question: string;
}

export interface SparkleContext {
  /** SEC 6.7 auto-capture output — the JD/company/title handed to the prompt as context. */
  job: JobContext;
  profileId: string | null;
  tone: AnswerTone;
  length: AnswerLength;
  /** `Settings.reuseBankedAnswers` — when false the bank is skipped and every click generates. */
  reuseBanked: boolean;
  /** False when the key vault is empty; the AI actions render disabled with the SEC 5.6 hint. */
  aiAvailable: boolean;
  /** Keys in the vault — fills the "…across N keys…" slot in the SEC 5.6 daily-exhaustion copy. */
  keyCount: number;
  pushToast: (spec: ToastSpec) => void;
  /** Writes into the page through the FillEngine's framework-safe path. Resolves false on failure. */
  writeValue: (el: HTMLElement, text: string) => Promise<boolean>;
  /** Current value of the field, for the "save what I wrote" (`user` provenance) path. */
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
      /** What produced the starting text — decides provenance on accept (SEC 5.7 step 4). */
      origin: 'ai' | 'bank' | 'user';
      baseline: string;
      bankSource: AnswerSource | null;
    };

/* ------------------------------------------------------------------------------------------------
 * Anchoring
 * ---------------------------------------------------------------------------------------------- */

const ANCHOR_INTERVAL_MS = 500;

/**
 * Track a host-page element's viewport rectangle without touching it.
 *
 * Same contract as `FieldMarkers`: read-only geometry, rAF-coalesced, capture-phase scroll so
 * fields inside scrollable panels track correctly. Returns null while the element is detached.
 */
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

/** Is any part of the anchor inside the viewport? Off-screen fields hide their ✨. */
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

/* ------------------------------------------------------------------------------------------------
 * Bus helpers
 * ---------------------------------------------------------------------------------------------- */

/**
 * INV-2 — mint a single-use nonce from inside the click handler. Never cached, never reused: the
 * bus burns it on first use and it dies 5 s after minting.
 */
async function mintGesture(reason: string): Promise<string | null> {
  const reply = await sendMessage('GESTURE_MINT', { reason });
  return reply.ok ? reply.data.gesture : null;
}

/* ------------------------------------------------------------------------------------------------
 * The affordance
 * ---------------------------------------------------------------------------------------------- */

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

  /* ---- generation (the only path that spends a key) ---------------------------------------- */

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

  /* ---- the ✨ click ------------------------------------------------------------------------ */

  const onSparkle = useCallback(() => {
    if (phase.kind !== 'idle') {
      close();
      return;
    }

    // INV-2: the nonce is minted here, synchronously inside the real user gesture. It is passed
    // down the whole chain so a bank *miss* can generate without asking for a second click.
    const gesturePromise = mintGesture('screening-answer');

    if (!ctx.reuseBanked) {
      void gesturePromise.then((token) => void generate(token));
      return;
    }

    setPhase({ kind: 'looking' });

    // SEC 5.7: the bank lookup runs BEFORE any key is leased and is a fully offline read.
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

  /* ---- accept ------------------------------------------------------------------------------ */

  /**
   * SEC 5.7 step 4 — "Whatever the user finally accepts, generated, edited, or typed from scratch,
   * is upserted with provenance (ai | ai-edited | user)."
   */
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

  /* ---- render ------------------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------------------------------------
 * The chip / draft panel
 * ---------------------------------------------------------------------------------------------- */

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
        : // SEC 5.7: 0.75-0.92 ⇒ "similar question" offer with a side-by-side preview.
          h(
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

  // Draft: editable, and explicitly labelled as a draft until the human accepts it.
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

/* ------------------------------------------------------------------------------------------------
 * Layer
 * ---------------------------------------------------------------------------------------------- */

export interface SparkleLayerProps {
  targets: readonly SparkleTarget[];
  ctx: SparkleContext;
}

/** Renders one ✨ per detected open-text question. Mounted into the overlay's `sparkles` layer. */
export function SparkleLayer({ targets, ctx }: SparkleLayerProps): ReactElement | null {
  if (targets.length === 0) return null;
  return h(
    'div',
    null,
    targets.map((target) => h(SparkleButton, { key: target.id, target, ctx })),
  );
}
