/**
 * tests/unit/field-controls.test.ts — the proactive per-field layer (`content/overlay/FieldControls`).
 *
 * This layer is the one that draws on a live job application before the user has asked for anything,
 * so the properties worth pinning down are the ones a mistake would make expensive:
 *
 *   1. **The icon matrix.** ✓ and ✗ appear only while there is a live offer; 💾 is always there and is
 *      disabled while there is nothing in the box to remember. A ✓ that survives its own acceptance
 *      is an invitation to overwrite the value it just wrote.
 *   2. **The page is not modified.** Not one attribute — and specifically not `placeholder`, which
 *      feeds `signatureFingerprint` and is therefore the field's *identity*: blanking it to make room
 *      for a ghost silently renames the field that `jf.mappings`, the ✗ ledger and the wizard's step
 *      detection are all keyed by. The regression test for that is `keeps the page's DOM untouched`.
 *   3. **Typing wins.** The first keystroke retires the ghost and wakes 💾 up; clearing the box back
 *      to empty brings the offer back, because a suggestion is not spent by being ignored.
 *   4. **A refusal is honoured before it is persisted.** `settle` is what the UI reacts to; the
 *      ledger write is the orchestrator's business and must not be on the redraw path.
 *   5. **INV-1.** Nothing here clicks or focuses a page element, ever.
 *
 * happy-dom lays nothing out, so every rectangle is stubbed — the same technique as
 * `tests/unit/suggest.test.ts`, and for the same reason: every eligibility rule reads geometry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FieldControls,
  canGhostControl,
  destroyOverlay,
  getOverlay,
  isBlockedControl,
  readAnswerValue,
  readControlValue,
  type FieldControlSpec,
} from '@/content';

/* ------------------------------------------------------------------------------------------------
 * Harness
 * ---------------------------------------------------------------------------------------------- */

interface Calls {
  accepted: string[];
  dismissed: string[];
  saved: string[];
  pending: number[];
}

let controls: FieldControls | null = null;
let calls: Calls;
let clickSpy: ReturnType<typeof vi.spyOn> | null = null;
let focusSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  calls = { accepted: [], dismissed: [], saved: [], pending: [] };
  // INV-1: this module has no business touching the page it draws over.
  clickSpy = vi.spyOn(HTMLElement.prototype, 'click');
  focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
});

afterEach(() => {
  controls?.dispose();
  controls = null;
  destroyOverlay();
});

function install(): FieldControls {
  controls = new FieldControls(getOverlay(), {
    onAccept: (id) => calls.accepted.push(id),
    onDismiss: (id) => calls.dismissed.push(id),
    onSave: (id) => calls.saved.push(id),
    onPendingChange: (count) => calls.pending.push(count),
  });
  return controls;
}

/** happy-dom lays nothing out, and every eligibility rule reads a rectangle. */
function stubRect(el: Element, width = 220, height = 34): void {
  const rect = { x: 40, y: 100, left: 40, top: 100, right: 40 + width, bottom: 100 + height, width, height };
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: (): DOMRect => ({ ...rect, toJSON: () => rect }) as DOMRect,
  });
}

function input(attrs: Record<string, string> = {}, value = ''): HTMLInputElement {
  const el = document.createElement('input');
  for (const [name, attr] of Object.entries(attrs)) el.setAttribute(name, attr);
  el.value = value;
  document.body.appendChild(el);
  stubRect(el);
  return el;
}

function spec(el: HTMLElement, over: Partial<FieldControlSpec> = {}): FieldControlSpec {
  return {
    id: over.id ?? 'hash-1',
    el,
    label: over.label ?? 'Email address',
    suggestion: over.suggestion ?? 'riya@example.com',
    ghost: over.ghost ?? true,
    ...(over.crowded === undefined ? {} : { crowded: over.crowded }),
  };
}

const layer = (): HTMLElement => getOverlay().layer('fields');
const clusters = (): HTMLElement[] => [...layer().querySelectorAll<HTMLElement>('.jf-cluster')];

function cluster(): HTMLElement {
  const first = clusters()[0];
  if (first === undefined) throw new Error('no cluster was drawn');
  return first;
}

function button(kind: 'accept' | 'dismiss' | 'save'): HTMLButtonElement {
  const el = cluster().querySelector<HTMLButtonElement>(`.jf-cluster__btn--${kind}`);
  if (el === null) throw new Error(`no ${kind} button in the cluster`);
  return el;
}

/** ✓ and ✗ are hidden as a pair by one class, which is what the CSS keys off. */
const offering = (): boolean => !cluster().classList.contains('jf-cluster--save-only');
const showing = (): boolean => cluster().classList.contains('jf-cluster--show');
const saveEnabled = (): boolean => button('save').getAttribute('aria-disabled') === 'false';
const ghostShowing = (): boolean =>
  layer().querySelector('.jf-ghost')?.classList.contains('jf-ghost--show') === true;
const ghostText = (): string => layer().querySelector('.jf-ghost')?.textContent ?? '';

function type(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ------------------------------------------------------------------------------------------------
 * The icon matrix (Feature D)
 * ---------------------------------------------------------------------------------------------- */

describe('which icons a control gets', () => {
  it('offers ✓ ✗ 💾 on a recognised, empty control — and 💾 is dim until there is something to keep', () => {
    install().set([spec(input({ type: 'email' }))]);

    expect(showing()).toBe(true);
    expect(offering()).toBe(true);
    expect(saveEnabled()).toBe(false);
    expect(ghostShowing()).toBe(true);
    expect(ghostText()).toBe('riya@example.com');
  });

  it('drops ✓ ✗ and keeps 💾 once the suggestion is accepted', () => {
    install().set([spec(input({ type: 'email' }))]);
    controls?.settle('hash-1', 'accepted');

    expect(offering()).toBe(false);
    expect(ghostShowing()).toBe(false);
    expect(button('save').isConnected).toBe(true);
  });

  it('drops ✓ ✗ and keeps 💾 once the suggestion is dismissed', () => {
    install().set([spec(input({ type: 'email' }))]);
    controls?.settle('hash-1', 'dismissed');

    expect(offering()).toBe(false);
    expect(ghostShowing()).toBe(false);
    expect(button('save').isConnected).toBe(true);
  });

  it('offers 💾 alone on a control with a typed value and nothing to suggest', () => {
    const el = input({ type: 'text' }, 'Only reachable on weekday evenings');
    install().set([spec(el, { suggestion: '', ghost: false })]);

    expect(offering()).toBe(false);
    expect(saveEnabled()).toBe(true);
    expect(ghostShowing()).toBe(false);
  });

  it('never ghosts a control that already holds an answer, even with a suggestion in hand', () => {
    install().set([spec(input({ type: 'email' }, 'someone.else@example.com'))]);

    expect(offering()).toBe(false);
    expect(saveEnabled()).toBe(true);
    expect(ghostShowing()).toBe(false);
  });

  it('stays out of the way on a control it has nothing to say about, until the user types', () => {
    const el = input({ type: 'text' });
    const layerControls = install();
    layerControls.set([spec(el, { suggestion: '', ghost: false })]);

    // The cluster exists — it has to be ready the instant there is something to keep — but a
    // hundred dim 💾 buttons down the side of a Workday step is noise, not a feature.
    expect(clusters()).toHaveLength(1);
    expect(showing()).toBe(false);
    expect(layerControls.pending).toBe(0);

    type(el, 'Two months');
    expect(showing()).toBe(true);
    expect(offering()).toBe(false);
    expect(saveEnabled()).toBe(true);

    type(el, '');
    expect(showing()).toBe(false);
  });

  it('reports the pending count so the bubble can badge it, and only when it changes', () => {
    const a = input({ type: 'email' });
    const b = input({ type: 'text' });
    const layerControls = install();

    layerControls.set([spec(a, { id: 'a' }), spec(b, { id: 'b' })]);
    expect(layerControls.pending).toBe(2);

    layerControls.settle('a', 'accepted');
    layerControls.settle('b', 'dismissed');
    expect(layerControls.pending).toBe(0);
    expect(calls.pending).toEqual([2, 1, 0]);
  });

  it('drops the pending count when the user answers a field themselves', () => {
    // The badge is the whole payload of the collapsed bubble. Counting "a suggestion was offered
    // once" rather than "a suggestion is still live" left it reading 2 on a form the user had just
    // finished typing — and saying so out loud, since it is also the bubble's accessible name.
    const a = input({ type: 'email' });
    const b = input({ type: 'text' });
    const layerControls = install();
    layerControls.set([spec(a, { id: 'a' }), spec(b, { id: 'b' })]);
    expect(layerControls.pending).toBe(2);

    type(a, 'mine@example.com');
    expect(layerControls.pending).toBe(1);
    type(b, 'typed this myself');
    expect(layerControls.pending).toBe(0);
    expect(calls.pending).toEqual([2, 1, 0]);

    // Cleared back to empty, the offer is live again — and so is the count.
    type(b, '');
    expect(layerControls.pending).toBe(1);
    expect(calls.pending).toEqual([2, 1, 0, 1]);
  });

  it('does not count a control whose suggestion arrived on an already-answered field', () => {
    install().set([spec(input({ type: 'email' }, 'someone.else@example.com'))]);
    expect(controls?.pending).toBe(0);
    expect(calls.pending).toEqual([0]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Blocked controls
 * ---------------------------------------------------------------------------------------------- */

describe('controls NextMove will not even mention', () => {
  it.each([
    ['a password', { type: 'password' }],
    ['a hidden input', { type: 'hidden' }],
    ['a one-time code', { type: 'text', autocomplete: 'one-time-code' }],
    ['a card number by autocomplete', { type: 'text', autocomplete: 'cc-number' }],
    ['a card field with a shipping prefix', { type: 'text', autocomplete: 'shipping cc-csc' }],
    ['a new password', { type: 'text', autocomplete: 'new-password' }],
    ['a CVV by name', { type: 'text', name: 'card_cvv' }],
    ['a camelCased one-time code', { type: 'text', name: 'oneTimeCode' }],
    ['a security code by data-automation-id', { type: 'text', 'data-automation-id': 'security-code' }],
    ['an OTP by id', { type: 'text', id: 'otp' }],
  ])('refuses %s', (_what, attrs) => {
    expect(isBlockedControl(input(attrs))).toBe(true);
  });

  it.each([
    ['an email', { type: 'email', autocomplete: 'email' }],
    ['a name that merely contains "card"', { type: 'text', name: 'cardiology_licence' }],
    ['a plain text field', { type: 'text' }],
  ])('allows %s', (_what, attrs) => {
    expect(isBlockedControl(input(attrs))).toBe(false);
  });
});

describe('what can carry a ghost', () => {
  it.each([
    ['text', 'text'],
    ['email', 'email'],
    ['tel', 'tel'],
    ['url', 'url'],
    ['number', 'number'],
    ['search', 'search'],
  ])('ghosts a %s input', (_what, type_) => {
    expect(canGhostControl(input({ type: type_ }))).toBe(true);
  });

  it.each([
    ['a date, whose own mm/dd/yyyy skeleton the ghost would land on top of', 'date'],
    ['a password', 'password'],
    ['a checkbox', 'checkbox'],
    ['a radio', 'radio'],
    ['a file input', 'file'],
  ])('does not ghost %s', (_what, type_) => {
    expect(canGhostControl(input({ type: type_ }))).toBe(false);
  });

  it('refuses a control too small to read a value in, or one the page has locked', () => {
    const tiny = input({ type: 'text' });
    stubRect(tiny, 40, 34);
    expect(canGhostControl(tiny)).toBe(false);

    const short = input({ type: 'text' });
    stubRect(short, 220, 10);
    expect(canGhostControl(short)).toBe(false);

    expect(canGhostControl(input({ type: 'text', readonly: 'readonly' }))).toBe(false);
    expect(canGhostControl(input({ type: 'text', disabled: 'disabled' }))).toBe(false);
  });

  it('ghosts a textarea, which is where the long answers live', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    stubRect(area, 380, 120);
    expect(canGhostControl(area)).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------
 * The page is left alone
 * ---------------------------------------------------------------------------------------------- */

describe('the host page', () => {
  it("keeps the page's DOM untouched — placeholder included, because it is the field's identity", () => {
    const el = input({ type: 'email', placeholder: 'you@company.com' });
    const before = el.outerHTML;

    install().set([spec(el)]);
    expect(el.placeholder).toBe('you@company.com');
    expect(el.outerHTML).toBe(before);

    controls?.settle('hash-1', 'dismissed');
    controls?.clear();
    expect(el.outerHTML).toBe(before);
  });

  it('draws a ghost on a control with no placeholder to fight over', () => {
    install().set([spec(input({ type: 'email' }))]);
    expect(ghostShowing()).toBe(true);
  });

  it('keeps the placeholder and drops the ghost when it cannot cover it, and still offers ✓', () => {
    // A control whose background cannot be resolved to something opaque would leave the page's
    // placeholder printing through the suggestion. One grey is more use than two.
    install().set([spec(input({ type: 'email', placeholder: 'you@company.com' }))]);
    expect(ghostShowing()).toBe(false);
    expect(offering()).toBe(true);
    expect(cluster().getAttribute('title')).toBe('riya@example.com');
  });

  it('covers the placeholder with the control’s own background when it can resolve one', () => {
    const el = input({ type: 'email', placeholder: 'you@company.com' });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node: Element, pseudo?: string | null) => {
      const style = real(node, pseudo ?? undefined);
      return { ...style, backgroundColor: 'rgb(255, 255, 255)' } as unknown as CSSStyleDeclaration;
    });

    install().set([spec(el)]);
    expect(ghostShowing()).toBe(true);
    expect(layer().querySelector<HTMLElement>('.jf-ghost')?.style.background).toBe('rgb(255, 255, 255)');
    expect(el.placeholder).toBe('you@company.com');
  });

  it('never clicks or focuses anything (INV-1)', () => {
    const el = input({ type: 'email' });
    install().set([spec(el)]);
    type(el, 'typed');
    button('save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    controls?.clear();

    expect(clickSpy?.mock.calls.length ?? 0).toBe(0);
    expect(focusSpy?.mock.calls.length ?? 0).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Typing
 * ---------------------------------------------------------------------------------------------- */

describe('when the user types', () => {
  it('retires the ghost at the first keystroke and wakes 💾 up', () => {
    const el = input({ type: 'email' });
    install().set([spec(el)]);
    expect(saveEnabled()).toBe(false);

    type(el, 'r');
    expect(ghostShowing()).toBe(false);
    expect(offering()).toBe(false);
    expect(saveEnabled()).toBe(true);
  });

  it('brings the offer back when the box is cleared again', () => {
    const el = input({ type: 'email' });
    install().set([spec(el)]);

    type(el, 'r');
    expect(offering()).toBe(false);
    type(el, '');
    expect(offering()).toBe(true);
    expect(ghostShowing()).toBe(true);
  });

  it('refuses to act on a ✓ the user can no longer see', () => {
    const el = input({ type: 'email' });
    install().set([spec(el)]);
    type(el, 'mine, thanks');

    button('accept').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button('dismiss').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.accepted).toEqual([]);
    expect(calls.dismissed).toEqual([]);
  });

  it('refuses to save an empty control', () => {
    install().set([spec(input({ type: 'email' }))]);
    button('save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.saved).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Keyboard and clicks
 * ---------------------------------------------------------------------------------------------- */

describe('accepting and refusing', () => {
  it('reports a ✓ click and a ✗ click to the orchestrator', () => {
    install().set([spec(input({ type: 'email' }))]);
    button('accept').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button('dismiss').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.accepted).toEqual(['hash-1']);
    // The ✓ did not settle anything by itself — the orchestrator does that once the write verified —
    // so the ✗ beside it is still live.
    expect(calls.dismissed).toEqual(['hash-1']);
  });

  it('takes the suggestion on Tab and refuses it on Esc', () => {
    const el = input({ type: 'email' });
    install().set([spec(el)]);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(calls.accepted).toEqual(['hash-1']);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(calls.dismissed).toEqual(['hash-1']);
  });

  it('leaves Shift+Tab, and every modified Tab, to the page', () => {
    const el = input({ type: 'email' });
    install().set([spec(el)]);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', metaKey: true, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true }));
    expect(calls.accepted).toEqual([]);
  });

  it('leaves Tab alone on a control it drew no ghost on', () => {
    const el = input({ type: 'text' }, 'already answered');
    install().set([spec(el, { suggestion: '', ghost: false })]);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(calls.accepted).toEqual([]);
  });

  it('retires the offer when the user ticks any member of a radio group, not just the first', () => {
    // SEC 6.2 models a group as ONE field whose element is its first member, so an event from the
    // second option has to resolve to the same entry — otherwise ticking "No" leaves ✓ still
    // offering "Yes" on a question the user has answered.
    document.body.innerHTML = `
      <label for="auth-yes">Yes, I am authorised</label>
      <input type="radio" id="auth-yes" name="auth" value="y" />
      <label for="auth-no">No, I need sponsorship</label>
      <input type="radio" id="auth-no" name="auth" value="n" />
    `;
    const yes = document.querySelector<HTMLInputElement>('#auth-yes');
    const no = document.querySelector<HTMLInputElement>('#auth-no');
    if (yes === null || no === null) throw new Error('the radio fixture is missing');
    stubRect(yes);
    stubRect(no);

    const layerControls = install();
    layerControls.set([spec(yes, { suggestion: 'Yes', ghost: false })]);
    expect(offering()).toBe(true);

    no.checked = true;
    no.dispatchEvent(new Event('change', { bubbles: true }));

    expect(offering()).toBe(false);
    expect(saveEnabled()).toBe(true);
    expect(layerControls.pending).toBe(0);
  });

  it('follows an event out of an open shadow root to the control that received it', () => {
    // The scanner walks into open shadow roots, so a control it hands us can live inside one — and an
    // event crossing that boundary is retargeted to the host. Keying off `event.target` left the
    // ghost painted over a field the user was typing into, hiding their text behind its backdrop.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('input');
    inner.type = 'email';
    shadow.appendChild(inner);
    stubRect(inner);

    install().set([spec(inner)]);
    expect(ghostShowing()).toBe(true);

    inner.value = 'typed inside the shadow root';
    inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

    expect(ghostShowing()).toBe(false);
    expect(offering()).toBe(false);
    expect(saveEnabled()).toBe(true);
  });

  it('says nothing about a control it does not own', () => {
    const mine = input({ type: 'email' });
    const theirs = input({ type: 'text' });
    const layerControls = install();
    layerControls.set([spec(mine)]);

    expect(layerControls.has(mine)).toBe(true);
    expect(layerControls.has(theirs)).toBe(false);

    // What `Suggest.ts` actually asks is "do you have an OFFER here" — a control this layer merely
    // keeps a 💾 for is still that layer's to help with.
    expect(layerControls.hasOffer(mine)).toBe(true);
    layerControls.settle(spec(mine).id, 'dismissed');
    expect(layerControls.has(mine)).toBe(true);
    expect(layerControls.hasOffer(mine)).toBe(false);

    theirs.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(calls.accepted).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Lifecycle
 * ---------------------------------------------------------------------------------------------- */

describe('lifecycle', () => {
  it('keeps a surviving control’s DOM across a re-scan so a click in flight is not eaten', () => {
    const el = input({ type: 'email' });
    const layerControls = install();
    layerControls.set([spec(el)]);
    const first = cluster();

    layerControls.set([spec(el)]);
    expect(cluster()).toBe(first);
  });

  it('re-offers a control whose suggested value changed', () => {
    const el = input({ type: 'email' });
    const layerControls = install();
    layerControls.set([spec(el)]);
    layerControls.settle('hash-1', 'dismissed');
    expect(offering()).toBe(false);

    layerControls.set([spec(el, { suggestion: 'someone@else.example' })]);
    expect(offering()).toBe(true);
    expect(ghostText()).toBe('someone@else.example');
  });

  it('removes controls that are no longer on the page', () => {
    const a = input({ type: 'email' });
    const b = input({ type: 'text' });
    const layerControls = install();

    layerControls.set([spec(a, { id: 'a' }), spec(b, { id: 'b' })]);
    expect(clusters()).toHaveLength(2);

    layerControls.set([spec(a, { id: 'a' })]);
    expect(clusters()).toHaveLength(1);

    layerControls.clear();
    expect(clusters()).toHaveLength(0);
  });

  it('lets the first of two controls sharing a signature speak, and only the first', () => {
    const a = input({ type: 'email' });
    const b = input({ type: 'email' });
    install().set([spec(a, { id: 'same' }), spec(b, { id: 'same' })]);
    expect(clusters()).toHaveLength(1);
  });

  it('hides a control that has scrolled far out of view', () => {
    const el = input({ type: 'email' });
    install().set([spec(el)]);
    expect(showing()).toBe(true);

    stubRect(el, 0, 0);
    window.dispatchEvent(new Event('resize'));
    // The pass is rAF-coalesced; drive it the way the browser would.
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        expect(showing()).toBe(false);
        resolve();
      });
    });
  });

  it('stops answering the document once disposed', () => {
    const el = input({ type: 'email' });
    const layerControls = install();
    layerControls.set([spec(el)]);
    layerControls.dispose();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    type(el, 'typed after disposal');
    expect(calls.accepted).toEqual([]);
    expect(clusters()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Reading a control
 * ---------------------------------------------------------------------------------------------- */

describe('what a control holds', () => {
  it('reads text, textareas and selects as their value', () => {
    expect(readControlValue(input({ type: 'text' }, 'typed'))).toBe('typed');

    const area = document.createElement('textarea');
    area.value = 'a longer answer';
    expect(readControlValue(area)).toBe('a longer answer');
  });

  it('reads a contenteditable as its text', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.textContent = 'rich text answer';
    document.body.appendChild(div);
    expect(readControlValue(div)).toBe('rich text answer');
  });

  it('reads an unticked checkbox as no answer at all, not as its value attribute', () => {
    const box = input({ type: 'checkbox' }, 'yes');
    expect(readControlValue(box)).toBe('yes');
    // …which is why 💾 asks this question instead.
    expect(readAnswerValue(box)).toBe('');
    box.checked = true;
    expect(readAnswerValue(box)).toBe('yes');
  });

  it('reads a placeholder-valued <select> as unanswered, the way the fill engine does', () => {
    // Plenty of ATS ship a first option carrying a real value whose text is "Please select".
    document.body.innerHTML = `
      <select id="hear-about-us">
        <option value="0">Please select…</option>
        <option value="ref">A former colleague</option>
      </select>
    `;
    const select = document.querySelector<HTMLSelectElement>('#hear-about-us');
    if (select === null) throw new Error('the select fixture is missing');
    stubRect(select);

    expect(readControlValue(select)).toBe('0');
    // …which is why 💾 and the offer gate ask this question instead.
    expect(readAnswerValue(select)).toBe('');

    select.selectedIndex = 1;
    expect(readAnswerValue(select)).toBe('A former colleague');
  });

  /**
   * "Select all that apply" is the shape `selectedIndex` gets wrong: it names one selection, so 💾
   * would have banked one language out of three — or the hint row, if the page had that selected too.
   *
   * Each case gets its OWN element, and none of them reads the control before selecting: happy-dom
   * has a bug where reading `selectedOptions` on a multi-select that has nothing selected leaves it
   * unable to register later `option.selected = true` assignments at all. Reuse one element across an
   * unanswered assertion and an answered one and the second half silently tests nothing.
   */
  function multiSelect(): HTMLSelectElement {
    const select = document.createElement('select');
    select.multiple = true;
    for (const [value, text] of [
      ['', 'Select all that apply'],
      ['py', 'Python'],
      ['go', 'Go'],
      ['rs', 'Rust'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    }
    document.body.appendChild(select);
    stubRect(select);
    return select;
  }

  it('reads an untouched multi-select as no answer at all', () => {
    expect(readAnswerValue(multiSelect())).toBe('');
  });

  it('reads a multi-select as every real option chosen, not just the first', () => {
    const select = multiSelect();
    for (const option of select.options) option.selected = option.value !== '';
    expect(readAnswerValue(select)).toBe('Python, Go, Rust');
  });

  it('leaves the valueless hint row out of the answer even when the page selects it', () => {
    const select = multiSelect();
    for (const option of select.options) option.selected = true;
    expect(readAnswerValue(select)).toBe('Python, Go, Rust');
  });

  it('falls back to an option’s value when its label is not a text node', () => {
    document.body.innerHTML = `
      <select id="country">
        <option value="">Choose…</option>
        <option value="IN" aria-label="India"></option>
      </select>
    `;
    const select = document.querySelector<HTMLSelectElement>('#country');
    if (select === null) throw new Error('the select fixture is missing');
    stubRect(select);

    select.selectedIndex = 1;
    // `textContent` is '' rather than null here, so a `??` fallback would never fire and an answered
    // dropdown would read as empty — leaving ✓ proposing a value for a question already answered.
    expect(readAnswerValue(select)).toBe('IN');
  });

  it('reads a radio group as the text of whichever member is checked', () => {
    document.body.innerHTML = `
      <label for="r-yes">Yes, I am authorised</label>
      <input type="radio" id="r-yes" name="auth" value="y" />
      <label for="r-no">No, I need sponsorship</label>
      <input type="radio" id="r-no" name="auth" value="n" />
    `;
    const yes = document.querySelector<HTMLInputElement>('#r-yes');
    const no = document.querySelector<HTMLInputElement>('#r-no');
    if (yes === null || no === null) throw new Error('the radio fixture is missing');

    expect(readAnswerValue(yes)).toBe('');
    no.checked = true;
    expect(readAnswerValue(yes)).toBe('No, I need sponsorship');
  });
});
