/**
 * core/fill/strategies/combobox.ts — typeaheads (Workday's whole UI, Ashby, react-select...).
 *
 * JF-001 Rev 3.0 · SEC 6.4: "focus -> clear -> dispatch per-character keydown/input (30-60 ms
 * jitter) -> await listbox via MutationObserver (3 s cap) -> click best option (exact > startsWith
 * > fuzzy) -> verify committed value, else mark `suggest`."
 *
 * Two INV-driven decisions worth stating out loud:
 *   - INV-1: we never send `Enter` to commit. A synthetic Enter in a form input is exactly the
 *     keystroke a page handler turns into a submission, and no combobox is worth that risk. If a
 *     click on the option does not commit, the field becomes a *suggestion* instead.
 *   - INV-4: the commit is verified through the bridge's READ_VALUE. A typeahead that swallowed our
 *     click leaves the raw query text sitting in the box, which looks filled and is not — so an
 *     unverifiable commit is downgraded rather than reported as a fill.
 */

import { click, readValue, setValue, typeSequence } from '../bridge';
import {
  accessibleName,
  assertNotSubmitControl,
  cssEscape,
  dispatchKey,
  isAborted,
  isSubmitControl,
  isVisible,
  readLocalValue,
  rootOf,
  sleep,
} from '../dom';
import { MIN_OPTION_SCORE, bestOption, normalize } from '../matching';
import { valueVariants } from './select';
import { textHasRealValue } from './text';
import {
  REASON,
  failed,
  filled,
  unverified,
  type FillRequest,
  type FillValue,
  type StrategyContext,
  type StrategyResult,
} from '../types';

/* ------------------------------------------------------------------------------------------------
 * Finding the popup
 * ---------------------------------------------------------------------------------------------- */

const DEFAULT_LISTBOX_SELECTORS = [
  '[role="listbox"]',
  '[data-automation-id="promptOption"]',
  '[data-automation-widget="selectinput"] ul',
  '.select__menu',
  '.react-select__menu',
  '[class*="autocomplete" i][class*="menu" i]',
  '[class*="typeahead" i] ul',
  'ul[class*="dropdown" i]',
  '.tt-menu',
  '.ui-autocomplete',
];

const DEFAULT_OPTION_SELECTORS = [
  '[role="option"]',
  '[data-automation-id="promptOption"]',
  '.select__option',
  '.react-select__option',
  'li[class*="option" i]',
  'li[class*="item" i]',
  '.tt-suggestion',
  '.ui-menu-item',
  'li',
];

/** Settle window: the listbox has stopped changing, so what we see is the final result set. */
const LISTBOX_SETTLE_MS = 120;
const LISTBOX_POLL_MS = 60;

function uniqueSelectors(extra: readonly string[], defaults: readonly string[]): string[] {
  return [...new Set([...extra, ...defaults])];
}

/** The popup this combobox owns, if it is currently rendered. */
export function findListbox(el: Element, extraSelectors: readonly string[]): HTMLElement | null {
  const root = rootOf(el);

  for (const attr of ['aria-controls', 'aria-owns']) {
    const ids = (el.getAttribute(attr) ?? '').split(/\s+/).filter((id) => id.length > 0);
    for (const id of ids) {
      const target = root.querySelector(`#${cssEscape(id)}`);
      if (target instanceof HTMLElement && isVisible(target)) return target;
    }
  }

  const selectors = uniqueSelectors(extraSelectors, DEFAULT_LISTBOX_SELECTORS);

  // Prefer a popup inside the widget's own container before scanning the whole document.
  const container = el.closest('[data-automation-id], [class*="select" i], [class*="combobox" i]');
  const scopes: ParentNode[] = container ? [container, root] : [root];

  for (const scope of scopes) {
    for (const selector of selectors) {
      let candidates: HTMLElement[];
      try {
        candidates = Array.from(scope.querySelectorAll<HTMLElement>(selector));
      } catch {
        continue; // a malformed remote-config selector must never break a fill run
      }
      for (const candidate of candidates) {
        if (!isVisible(candidate)) continue;
        if (candidate.contains(el)) continue;
        if (collectOptionElements(candidate, extraSelectors).length > 0) return candidate;
      }
    }
  }

  return null;
}

export function collectOptionElements(
  listbox: Element,
  extraSelectors: readonly string[],
): HTMLElement[] {
  const selectors = uniqueSelectors(extraSelectors, DEFAULT_OPTION_SELECTORS);
  for (const selector of selectors) {
    let found: HTMLElement[];
    try {
      found = Array.from(listbox.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }
    const usable = found.filter((option) => {
      if (option.getAttribute('aria-disabled') === 'true') return false;
      if (option.hasAttribute('disabled')) return false;
      // INV-1: a popup must never hand us something that submits the application.
      if (isSubmitControl(option)) return false;
      return accessibleName(option).length > 0;
    });
    if (usable.length > 0) return usable;
  }
  return [];
}

/**
 * Wait for the popup to render *and stop changing*. Async result sets arrive over two paints
 * ("Loading..." and then the rows); picking during the first one is how you end up selecting
 * "No results". Capped at `timeoutMs` (SEC 6.4 — 3 s).
 */
export async function awaitListbox(
  el: Element,
  timeoutMs: number,
  extraSelectors: readonly string[],
  signal?: AbortSignal,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  const doc = el.ownerDocument ?? document;
  const root = doc.documentElement;

  let wake: (() => void) | null = null;
  const observer = new MutationObserver(() => {
    const fn = wake;
    wake = null;
    if (fn) fn();
  });
  if (root) observer.observe(root, { childList: true, subtree: true, attributes: true });

  let lastSignature = '';
  let stableSince = 0;

  try {
    while (Date.now() < deadline) {
      if (isAborted(signal)) return null;

      const listbox = findListbox(el, extraSelectors);
      if (listbox) {
        const options = collectOptionElements(listbox, extraSelectors);
        const signature = options.map((option) => accessibleName(option)).join('');
        if (signature.length > 0) {
          if (signature === lastSignature) {
            if (stableSince > 0 && Date.now() - stableSince >= LISTBOX_SETTLE_MS) return listbox;
          } else {
            lastSignature = signature;
            stableSince = Date.now();
          }
        }
      }

      // Woken by the observer, or by the poll timer — whichever comes first.
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        wake = finish;
        setTimeout(finish, LISTBOX_POLL_MS);
      });
    }
  } finally {
    observer.disconnect();
  }

  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Picking
 * ---------------------------------------------------------------------------------------------- */

function optionTexts(option: HTMLElement): string[] {
  const texts = [accessibleName(option)];
  const value = option.getAttribute('data-value') ?? option.getAttribute('value');
  if (value !== null) texts.push(value);
  return texts.filter((text) => text.trim().length > 0);
}

/** exact > startsWith > fuzzy (SEC 6.4), via the shared option ranker. */
export function pickBestOption(
  options: readonly HTMLElement[],
  variants: readonly string[],
): HTMLElement | null {
  const choice = bestOption(options, optionTexts, variants, MIN_OPTION_SCORE);
  return choice?.item ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Strategy
 * ---------------------------------------------------------------------------------------------- */

function desiredText(value: FillValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return (value[0] ?? '').trim();
  return value.trim();
}

/** The query we type: long values scare typeaheads that only match on a prefix. */
function queryFor(text: string): string {
  if (text.length <= 40) return text;
  const cut = text.slice(0, 40);
  const space = cut.lastIndexOf(' ');
  return space > 12 ? cut.slice(0, space) : cut;
}

function committedLooksRight(actual: string, variants: readonly string[], chosen: string): boolean {
  const a = normalize(actual);
  if (a.length === 0) return false;
  const c = normalize(chosen);
  if (c.length > 0 && (a === c || a.includes(c) || c.includes(a))) return true;
  for (const variant of variants) {
    const v = normalize(variant);
    if (v.length > 0 && (a === v || a.includes(v) || v.includes(a))) return true;
  }
  return false;
}

/** Full SEC 6.4 typeahead flow. Returns `suggest`-grade results rather than lying (INV-4). */
export async function fillCombobox(
  el: Element,
  value: FillValue,
  ctx: StrategyContext,
  request: FillRequest = {},
): Promise<StrategyResult> {
  try {
    assertNotSubmitControl(el, 'fill'); // INV-1
  } catch {
    return failed(REASON.submitControl);
  }

  const text = desiredText(value);
  if (text.length === 0) return failed(REASON.noValue);

  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    return failed(REASON.notFillable);
  }
  if (el.disabled || el.readOnly) return failed(REASON.notFillable);

  const callOptions = ctx.preferLocal === true ? { preferLocal: true } : undefined;
  const label = `${ctx.sig?.label ?? ''} ${ctx.sig?.name ?? ''} ${ctx.sig?.id ?? ''}`;
  const variants = valueVariants(text, label);
  const query = queryFor(variants[0] ?? text);

  // An already-answered typeahead is left exactly as it is (see `comboboxHasRealValue`). Step 2
  // below CLEARS the field before typing, which is exactly how a selection the user made by hand
  // was being destroyed. A standing selection that is already the one we would have picked counts
  // as `filled` — the field is correct and the report should say so; anything else is a skip, not
  // an error, because declining to clobber an answer is the strategy working.
  if (request.overwrite !== true && comboboxHasRealValue(el)) {
    return alreadyShows(selectionText(el), variants) ? filled() : failed(REASON.alreadyAnswered);
  }

  // 1. focus — a typeahead that never receives focus never opens its popup.
  el.focus();

  // 2. clear. SET_VALUE fires a bubbled blur by contract, so re-focus before typing.
  if ((readLocalValue(el) ?? '').length > 0) {
    await setValue(el, '', callOptions);
    el.focus();
  }

  // 3. per-character keystrokes with 30-60 ms jitter (SEC 6.4; SEC 13 — human-paced writes).
  const typed = await typeSequence(el, query, ctx.quirks.typeaheadDelayMs, {
    ...(callOptions ?? {}),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  if (!typed.ok) return failed(REASON.bridgeFailed);
  if (isAborted(ctx.signal)) return failed(REASON.aborted);

  // Normalise if the keystroke stream did not land verbatim (some widgets rewrite as you type).
  const afterTyping = readLocalValue(el) ?? '';
  if (normalize(afterTyping) !== normalize(query)) {
    await setValue(el, query, callOptions);
    el.focus();
  }

  // 4. await the listbox, capped at 3 s.
  const listbox = await awaitListbox(
    el,
    ctx.quirks.listboxWaitMs,
    ctx.quirks.listboxSelectors,
    ctx.signal,
  );
  if (!listbox) {
    dispatchKey(el, 'keydown', 'Escape'); // leave no popup hanging over the form
    // The query text is sitting in the field and may well be right, but nothing confirmed it.
    return unverified(REASON.listboxTimeout);
  }

  // 5. pick the best option: exact > startsWith > fuzzy.
  const options = collectOptionElements(listbox, ctx.quirks.optionSelectors);
  const target = pickBestOption(options, variants);
  if (!target) {
    dispatchKey(el, 'keydown', 'Escape');
    return unverified(REASON.noOptionMatch);
  }

  const chosenText = accessibleName(target);

  // 6. click it. Never Enter — INV-1: a synthetic Enter is one page handler away from a submit.
  const clicked = await click(target, callOptions);
  if (!clicked.ok) {
    dispatchKey(el, 'keydown', 'Escape');
    return unverified(REASON.notCommitted);
  }

  // 7. verify the committed value through the bridge (READ_VALUE).
  await sleep(ctx.quirks.verifyDelayMs, ctx.signal);
  if (isAborted(ctx.signal)) return failed(REASON.aborted);

  const read = await readValue(el, callOptions);
  if (read.ok && committedLooksRight(read.value, variants, chosenText)) return filled();

  // Some widgets clear the input and render the selection as a chip/pill beside it.
  if (selectionChipMatches(el, chosenText)) return filled();

  // INV-4: cannot prove the commit, so downgrade to `suggest` and let the overlay ask the human.
  return unverified(REASON.commitUnverified);
}

/** The wrapper a typeahead renders its popup and its committed selection into. */
function widgetContainer(el: Element): Element | null {
  return (
    el.closest('[data-automation-id], [class*="select" i], [class*="combobox" i]') ??
    el.parentElement
  );
}

function nodesMatching(container: Element, selectors: readonly string[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const selector of selectors) {
    try {
      out.push(...Array.from(container.querySelectorAll<HTMLElement>(selector)));
    } catch {
      continue; // a malformed remote-config selector must never break a fill run
    }
  }
  return out;
}

/**
 * Nodes that mean "this typeahead is holding a selection", for the widgets that render the
 * committed value beside the input instead of inside it (react-select, Workday).
 *
 * Deliberately narrower than the set `selectionChipMatches` searches. That one only accepts a node
 * whose TEXT is the option we just clicked, so a loose `[class*="tag" i]` — which also matches
 * "advantage", "vintage", "stage" — costs nothing. Asking the opposite question, "is there any
 * selection at all", has no text to check against, and a false positive there leaves a genuinely
 * empty field blank because the engine believed the user had already answered it.
 */
const SELECTION_NODE_SELECTORS = [
  '[data-automation-id="selectedItem"]',
  '[class*="singleValue" i]',
  '[class*="single-value" i]',
  '[class*="multiValue" i]',
  '[class*="multi-value" i]',
];

/** What the widget currently shows as its answer: its own text, else its selection chip. */
function selectionText(el: Element): string {
  if (textHasRealValue(el)) return readLocalValue(el) ?? '';

  const container = widgetContainer(el);
  if (container === null) return '';
  for (const node of nodesMatching(container, SELECTION_NODE_SELECTORS)) {
    const text = (node.textContent ?? '').trim();
    if (text.length > 0) return text;
  }
  return '';
}

/**
 * Does this typeahead already carry a real selection?
 *
 * The combobox clause of the engine's one "already answered" policy (`isAlreadyAnswered`). Two
 * shapes count, because both are answers to the human reading the page: text sitting in the input,
 * and a committed selection rendered as a chip next to an input the widget keeps empty.
 */
export function comboboxHasRealValue(el: Element): boolean {
  return selectionText(el).length > 0;
}

/**
 * Is the selection the widget is already showing the one we were about to pick?
 *
 * The standing text has to CONTAIN the whole variant, which is how a typeahead legitimately renders
 * a choice ("Bengaluru, Karnataka, India" for "Bengaluru"). The reverse — a variant containing the
 * standing text — is not accepted: a lone "B" the user was in the middle of typing is not an answer
 * of "Bengaluru", and reporting it as one would claim a fill that never happened.
 */
function alreadyShows(standing: string, variants: readonly string[]): boolean {
  const a = normalize(standing);
  if (a.length === 0) return false;
  return variants.some((variant) => {
    const v = normalize(variant);
    return v.length > 0 && a.includes(v);
  });
}

/** react-select and Workday render the committed value beside the input, not inside it. */
function selectionChipMatches(el: Element, chosenText: string): boolean {
  const wanted = normalize(chosenText);
  if (wanted.length === 0) return false;

  const container = widgetContainer(el);
  if (container === null) return false;

  const chipSelectors = [
    ...SELECTION_NODE_SELECTORS,
    '[class*="chip" i]',
    '[class*="pill" i]',
    '[class*="tag" i]',
    '[aria-selected="true"]',
  ];

  for (const node of nodesMatching(container, chipSelectors)) {
    if (normalize(node.textContent ?? '').includes(wanted)) return true;
  }
  return false;
}
