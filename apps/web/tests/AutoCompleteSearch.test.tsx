/**
 * The close control on the search modal.
 *
 * This test exists because of a specific near-miss. `AutoCompleteSearch` originally rendered a
 * bare `<IoMdClose>` icon with no handler — an X that looked clickable and did nothing. A later
 * lint-cleanup pass wrapped it in a real `<button onClick={() => setOpen?.(false)}>`, which is
 * the correct behaviour, but it arrived as an untested behaviour change smuggled into a
 * formatting commit. Nothing in the repo would have noticed if it were reverted, or if the
 * handler were dropped again the next time someone tidied the file.
 *
 * Keeping the button is the right call: `ModalContainer` closes the modal when the backdrop is
 * clicked, and `AutoCompleteSearch` stops propagation on its own panel, so without a working X
 * there is no close affordance anywhere inside the panel itself.
 *
 * So: pin it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AutoCompleteSearch from '@/components/modals/AutoCompleteSearch';

// React 19 reads this to decide whether it is running inside an act() scope.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function render(node: React.ReactElement): void {
  act(() => {
    root.render(node);
  });
}

function closeButton(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('button[aria-label="Close search"]');
  if (!el) throw new Error('close control not found');
  return el;
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('AutoCompleteSearch close control', () => {
  it('renders the X as a real button, not an inert icon', () => {
    render(<AutoCompleteSearch setOpen={vi.fn()} />);

    const btn = closeButton();
    expect(btn.tagName).toBe('BUTTON');
    // type="button" matters: the control sits next to a text input, and a default-type button
    // inside a form would submit it.
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('closes the modal when clicked', () => {
    const setOpen = vi.fn();
    render(<AutoCompleteSearch setOpen={setOpen} />);

    click(closeButton());

    expect(setOpen).toHaveBeenCalledTimes(1);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('does not throw when rendered without a setOpen handler', () => {
    render(<AutoCompleteSearch />);

    expect(() => click(closeButton())).not.toThrow();
  });

  it('keeps clicks inside the panel from reaching the backdrop', () => {
    // ModalContainer's backdrop closes the modal on click. The panel calls stopPropagation so
    // that clicking the search field does not dismiss it; only the X should close from inside.
    const backdropClicked = vi.fn();
    const backdrop = document.createElement('div');
    backdrop.addEventListener('click', backdropClicked);
    backdrop.appendChild(container);
    document.body.appendChild(backdrop);

    const setOpen = vi.fn();
    render(<AutoCompleteSearch setOpen={setOpen} />);

    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    click(input as HTMLInputElement);
    expect(backdropClicked).not.toHaveBeenCalled();
    expect(setOpen).not.toHaveBeenCalled();

    click(closeButton());
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(backdropClicked).not.toHaveBeenCalled();

    backdrop.remove();
  });

  it('labels the panel with the thing being searched for', () => {
    render(<AutoCompleteSearch setOpen={vi.fn()} searchFor="Role" />);

    expect(container.textContent).toContain('Search for');
    expect(container.textContent).toContain('Role');
  });
});
