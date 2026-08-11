/**
 * tests/unit/suggest.test.ts — the v2.2 ghost-text suggestion layer (`content/overlay/Suggest.ts`).
 *
 * Five properties, each one a bug that would be felt immediately if it regressed:
 *
 *   1. the fuzzy ladder ranks exact > prefix > substring > shared-words > nothing, so an option
 *      list is never answered by a coincidence;
 *   2. a dropdown that is already answered is left alone — including the ATS shape where the
 *      selected option carries a real `value` but reads "Please select";
 *   3. typing takes the ghost away (and gives the page its placeholder back) while leaving 🔖;
 *   4. Esc sticks: a refused field is never offered a suggestion again, and is not even looked up;
 *   5. `setEnabled(false)` removes the host from the page and stops answering focus.
 *
 * Plus the one write this module is allowed to make: it goes through the prototype `value` setter
 * (React's own-property trap must not see it) and it never clicks anything (INV-1).
 *
 * The layer renders into a *closed* shadow root, so `attachShadow` is spied and forced open for
 * the duration of a test. That keeps production closed (SEC 4.4) while the assertions can still
 * read what the user would see — better than exporting internals purely to be testable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installSuggest,
  matchScore,
  selectHasRealValue,
  SUGGEST_HOST_ID,
  type SuggestController,
  type SuggestDeps,
} from '@/content/overlay/Suggest';

/* ------------------------------------------------------------------------------------------------
 * Harness
 * ---------------------------------------------------------------------------------------------- */

let shadow: ShadowRoot | null = null;
let controller: SuggestController | null = null;
let clickSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  shadow = null;
  document.body.innerHTML = '';

  const nativeAttachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ): ShadowRoot {
    const root = nativeAttachShadow.call(this, { ...init, mode: 'open' });
    shadow = root;
    return root;
  });

  // INV-1: this module has no business clicking anything, on any path.
  clickSpy = vi.spyOn(HTMLElement.prototype, 'click');
});

afterEach(() => {
  controller?.destroy();
  controller = null;
});

interface Deps {
  lookup: ReturnType<typeof vi.fn>;
  remember: ReturnType<typeof vi.fn>;
  toasts: string[];
}

function install(suggestion: string | null): Deps {
  const toasts: string[] = [];
  const lookup = vi.fn(async () => suggestion);
  const remember = vi.fn(async () => undefined);
  const deps: SuggestDeps = {
    lookup,
    remember,
    onToast: (message: string) => toasts.push(message),
  };
  controller = installSuggest(deps);
  return { lookup, remember, toasts };
}

/** happy-dom lays nothing out, and every eligibility check reads a rectangle. */
function stubRect(el: Element, width: number, height: number): void {
  const rect = { x: 40, y: 100, left: 40, top: 100, right: 40 + width, bottom: 100 + height, width, height };
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: (): DOMRect => ({ ...rect, toJSON: () => rect }) as DOMRect,
  });
}

function need<T extends Element>(selector: string): T {
  const root = shadow;
  if (root === null) throw new Error('the suggest layer never attached a shadow root');
  const el = root.querySelector<T>(selector);
  if (el === null) throw new Error(`no ${selector} in the suggest shadow root`);
  return el;
}

const ghost = (): HTMLElement => need<HTMLElement>('.nm-ghost');
const bar = (): HTMLElement => need<HTMLElement>('.nm-bar');

const ghostShowing = (): boolean => ghost().classList.contains('nm-ghost--show');
const barShowing = (): boolean => bar().classList.contains('nm-bar--show');
/** The bar collapses to 🔖 alone once there is nothing left to accept. */
const rememberOnly = (): boolean => bar().classList.contains('nm-bar--remember-only');

/** Let the injected `lookup` promise settle. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function textField(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  const input = document.querySelector('input');
  if (input === null) throw new Error('fixture has no input');
  stubRect(input, 220, 32);
  return input;
}

/* ------------------------------------------------------------------------------------------------
 * 1 · the fuzzy ladder
 * ---------------------------------------------------------------------------------------------- */

describe('matchScore · the v2.2 ladder', () => {
  it('scores exact 100, prefix 80, substring 60, shared words 50, unrelated 0', () => {
    expect(matchScore('India', 'india')).toBe(100);
    expect(matchScore('United States of America', 'United States')).toBe(80);
    expect(matchScore('I am authorised to work', 'authorised')).toBe(60);
    expect(matchScore('Bachelor of Science degree', 'science bachelor')).toBe(50);
    expect(matchScore('Yes', 'Germany')).toBe(0);
  });

  it('ranks the rungs strictly, so a coincidence can never outscore a real answer', () => {
    const value = 'Bachelor of Science';
    const exact = matchScore('Bachelor of Science', value);
    const prefix = matchScore('Bachelor of Science (Hons)', value);
    const substring = matchScore('Completed a Bachelor of Science before 2019', value);
    const overlap = matchScore('Science, Bachelor', value);
    const none = matchScore('Doctorate', value);

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(overlap);
    expect(overlap).toBeGreaterThan(none);
    expect(none).toBe(0);
  });

  it('treats empty text on either side as no match at all', () => {
    expect(matchScore('', 'India')).toBe(0);
    expect(matchScore('India', '')).toBe(0);
    expect(matchScore('   ', 'India')).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 2 · the "already answered" dropdown guard
 * ---------------------------------------------------------------------------------------------- */

function selectField(optionsHtml: string): HTMLSelectElement {
  document.body.innerHTML = `<label for="s">Country</label><select id="s">${optionsHtml}</select>`;
  const select = document.querySelector('select');
  if (select === null) throw new Error('fixture has no select');
  stubRect(select, 200, 32);
  return select;
}

describe('selectHasRealValue · what counts as an answered dropdown', () => {
  it('an empty-valued prompt option is not an answer', () => {
    const select = selectField('<option value="">Select…</option><option value="IN">India</option>');
    expect(selectHasRealValue(select)).toBe(false);
  });

  it('a prompt option that carries a real value is still not an answer', () => {
    const select = selectField('<option value="0">-- Choose one --</option><option value="IN">India</option>');
    expect(selectHasRealValue(select)).toBe(false);
  });

  it('a genuinely chosen option is an answer', () => {
    const select = selectField('<option value="">Select…</option><option value="IN">India</option>');
    select.value = 'IN';
    expect(selectHasRealValue(select)).toBe(true);
  });

  it('does not offer to overwrite a dropdown the user already answered', async () => {
    const select = selectField('<option value="">Select…</option><option value="IN">India</option>');
    select.value = 'IN';
    const deps = install('India');

    select.focus();
    await settle();

    expect(deps.lookup).not.toHaveBeenCalled();
    expect(barShowing()).toBe(true); // 🔖 is still on offer …
    expect(rememberOnly()).toBe(true); // … but nothing is proposed
  });

  it('offers the fuzzy-matched option on an unanswered dropdown', async () => {
    const select = selectField('<option value="">Select…</option><option value="IN">India</option>');
    const deps = install('india');

    select.focus();
    await settle();

    expect(deps.lookup).toHaveBeenCalledWith('Country');
    expect(rememberOnly()).toBe(false);
    expect(need<HTMLButtonElement>('.nm-btn--accept').title).toBe('Use "India"');
  });
});

/* ------------------------------------------------------------------------------------------------
 * 3 · typing takes the ghost away
 * ---------------------------------------------------------------------------------------------- */

describe('the ghost', () => {
  it('appears over an empty field and hides the page placeholder while it is up', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" placeholder="Your name" />');
    const deps = install('Ada Lovelace');

    input.focus();
    await settle();

    expect(deps.lookup).toHaveBeenCalledWith('Full name');
    expect(ghostShowing()).toBe(true);
    expect(ghost().textContent).toBe('Ada Lovelace');
    expect(input.placeholder).toBe('');
  });

  it('disappears as soon as the user types, keeping 🔖 and giving the placeholder back', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" placeholder="Your name" />');
    install('Ada Lovelace');

    input.focus();
    await settle();
    expect(ghostShowing()).toBe(true);

    input.value = 'Ad';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(ghostShowing()).toBe(false);
    expect(barShowing()).toBe(true);
    expect(rememberOnly()).toBe(true);
    expect(input.placeholder).toBe('Your name');
  });

  it('comes back if the field is cleared again — without a second lookup', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" />');
    const deps = install('Ada Lovelace');

    input.focus();
    await settle();

    input.value = 'Ad';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(ghostShowing()).toBe(true);
    expect(deps.lookup).toHaveBeenCalledTimes(1);
  });

  it('is never offered for a field the user already filled in', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" />');
    const deps = install('Ada Lovelace');
    input.value = 'Grace Hopper';

    input.focus();
    await settle();

    expect(deps.lookup).not.toHaveBeenCalled();
    expect(ghostShowing()).toBe(false);
    expect(rememberOnly()).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 4 · Esc sticks
 * ---------------------------------------------------------------------------------------------- */

describe('dismissal', () => {
  it('Esc drops the ghost and the field stays refused for the life of the page', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" placeholder="Your name" />');
    const deps = install('Ada Lovelace');

    input.focus();
    await settle();
    expect(ghostShowing()).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(ghostShowing()).toBe(false);
    expect(rememberOnly()).toBe(true);
    expect(input.placeholder).toBe('Your name');

    // Leave and come back: no ghost, and the bank is not even asked a second time.
    input.blur();
    input.focus();
    await settle();

    expect(ghostShowing()).toBe(false);
    expect(deps.lookup).toHaveBeenCalledTimes(1);
  });

  it('Tab accepts and writes through the prototype setter, not the element property', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" />');
    install('Ada Lovelace');

    // Stand in for React's own-property value trap: a write that lands here never reaches the
    // framework's state, which is the whole reason this module bypasses it.
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const protoGet = proto?.get;
    const protoSet = proto?.set;
    expect(protoGet).toBeTypeOf('function');
    expect(protoSet).toBeTypeOf('function');

    let trapped = 0;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: (): string => String(protoGet?.call(input) ?? ''),
      set: (next: string): void => {
        trapped += 1;
        protoSet?.call(input, next);
      },
    });

    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    input.focus();
    await settle();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(input.value).toBe('Ada Lovelace');
    expect(trapped).toBe(0);
    expect(events).toEqual(['input', 'change']);
    expect(ghostShowing()).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled(); // INV-1
  });
});

/* ------------------------------------------------------------------------------------------------
 * 4b · the keyboard and the bar tell the same story
 *
 * The bar hides ✓ the moment the user answers for themselves; if Tab still reached `accept()` at
 * that point the layer would silently replace an answer on a real job application — the one thing
 * this module is not allowed to do. Both paths must read a single "is an accept on offer" predicate.
 * ---------------------------------------------------------------------------------------------- */

describe('an answer the user gave themselves', () => {
  it('is not replaced by Tab after they pick their own option from a dropdown', async () => {
    const select = selectField(
      '<option value="">Select…</option><option value="IN">India</option><option value="DE">Germany</option>',
    );
    install('India');

    select.focus();
    await settle();
    expect(rememberOnly()).toBe(false); // the India offer is up

    // The user ignores the offer and picks Germany themselves.
    select.value = 'DE';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rememberOnly()).toBe(true); // ✓ has left the bar …

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    select.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(false); // … so Tab is the page's own key again
    expect(select.value).toBe('DE');
    expect(clickSpy).not.toHaveBeenCalled(); // INV-1
  });

  it('is not replaced by Tab after they type their own value into a text field', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" />');
    install('Ada Lovelace');

    input.focus();
    await settle();
    expect(ghostShowing()).toBe(true);

    input.value = 'Grace Hopper';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rememberOnly()).toBe(true);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(false);
    expect(input.value).toBe('Grace Hopper');
  });

  it('cannot be replaced by the ✓ button either, once the bar has retired the offer', async () => {
    const select = selectField(
      '<option value="">Select…</option><option value="IN">India</option><option value="DE">Germany</option>',
    );
    install('India');

    select.focus();
    await settle();

    select.value = 'DE';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    // CSS hides the button, but a stray click must not be able to write either.
    need<HTMLButtonElement>('.nm-btn--accept').dispatchEvent(new Event('click', { bubbles: true }));

    expect(select.value).toBe('DE');
  });
});

describe('a live offer is still accepted', () => {
  it('Tab takes the matched option on an untouched dropdown', async () => {
    const select = selectField(
      '<option value="">Select…</option><option value="IN">India</option><option value="DE">Germany</option>',
    );
    install('India');

    select.focus();
    await settle();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    select.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(select.value).toBe('IN');
    expect(rememberOnly()).toBe(true); // the offer retires once it has been taken
    expect(clickSpy).not.toHaveBeenCalled(); // INV-1
  });

  it('comes back if the user puts the dropdown back to the prompt option', async () => {
    const select = selectField(
      '<option value="">Select…</option><option value="IN">India</option><option value="DE">Germany</option>',
    );
    const deps = install('India');

    select.focus();
    await settle();

    select.value = 'DE';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rememberOnly()).toBe(true);

    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(rememberOnly()).toBe(false);
    expect(deps.lookup).toHaveBeenCalledTimes(1); // the offer was kept, not looked up again
  });
});

/* ------------------------------------------------------------------------------------------------
 * 5 · the power switch
 * ---------------------------------------------------------------------------------------------- */

describe('setEnabled(false)', () => {
  it('removes the host from the page and stops answering focus', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" placeholder="Your name" />');
    const deps = install('Ada Lovelace');

    input.focus();
    await settle();
    expect(document.getElementById(SUGGEST_HOST_ID)).not.toBeNull();
    expect(ghostShowing()).toBe(true);

    controller?.setEnabled(false);

    expect(document.getElementById(SUGGEST_HOST_ID)).toBeNull();
    expect(input.placeholder).toBe('Your name'); // the page is left exactly as it was found

    input.blur();
    input.focus();
    await settle();

    expect(document.getElementById(SUGGEST_HOST_ID)).toBeNull();
    expect(deps.lookup).toHaveBeenCalledTimes(1);
  });

  it('switches back on again', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" />');
    install('Ada Lovelace');

    controller?.setEnabled(false);
    controller?.setEnabled(true);

    input.focus();
    await settle();

    expect(document.getElementById(SUGGEST_HOST_ID)).not.toBeNull();
    expect(ghostShowing()).toBe(true);
  });

  it('destroy() leaves nothing behind', async () => {
    const input = textField('<label for="n">Full name</label><input id="n" />');
    const deps = install('Ada Lovelace');

    input.focus();
    await settle();

    controller?.destroy();
    controller = null;

    expect(document.getElementById(SUGGEST_HOST_ID)).toBeNull();

    input.blur();
    input.focus();
    await settle();
    expect(deps.lookup).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Radios and checkboxes — 🔖 only, never a suggestion
 * ---------------------------------------------------------------------------------------------- */

describe('radio and checkbox', () => {
  it('remembers a radio as the group question → the chosen option', async () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Are you legally authorised to work in the US?</legend>
        <label><input type="radio" name="auth" value="y" /> Yes</label>
        <label><input type="radio" name="auth" value="n" /> No</label>
      </fieldset>`;
    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
    for (const radio of radios) stubRect(radio, 16, 16);
    const first = radios[0];
    if (!(first instanceof HTMLInputElement)) throw new Error('fixture has no radio');
    for (const label of Array.from(document.querySelectorAll('label'))) stubRect(label, 120, 20);

    const deps = install(null);
    first.checked = true;
    first.dispatchEvent(new Event('change', { bubbles: true }));

    expect(barShowing()).toBe(true);
    expect(rememberOnly()).toBe(true);
    expect(deps.lookup).not.toHaveBeenCalled();

    need<HTMLButtonElement>('.nm-btn--remember').dispatchEvent(new Event('click', { bubbles: true }));
    await settle();

    expect(deps.remember).toHaveBeenCalledWith('Are you legally authorised to work in the US?', 'Yes');
    expect(deps.toasts).toEqual(['Remembered — NextMove will use this next time']);
    expect(clickSpy).not.toHaveBeenCalled(); // INV-1
  });

  it('remembers a checkbox as yes/no', async () => {
    document.body.innerHTML = `<label><input type="checkbox" id="c" /> Willing to relocate</label>`;
    const checkbox = document.getElementById('c');
    if (!(checkbox instanceof HTMLInputElement)) throw new Error('fixture has no checkbox');
    stubRect(checkbox, 16, 16);
    for (const label of Array.from(document.querySelectorAll('label'))) stubRect(label, 160, 20);

    const deps = install(null);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    need<HTMLButtonElement>('.nm-btn--remember').dispatchEvent(new Event('click', { bubbles: true }));
    await settle();

    expect(deps.remember).toHaveBeenCalledWith('Willing to relocate', 'yes');
  });
});
