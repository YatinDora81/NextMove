/**
 * ui/components/Modal.tsx — a focus-trapping dialog built on the native `<dialog>` element.
 *
 * `showModal()` gives us the top layer, the backdrop, inert background content and Escape-to-close
 * for free — all things a div-with-position-fixed has to reimplement badly. The only things added
 * here are returning focus to the opener and routing the native `cancel` event through `onClose`,
 * so a destructive dialog (wipe everything) can never be dismissed into an ambiguous state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode, SyntheticEvent } from 'react';

import { Close } from '@/ui/icons';

import { Button } from './Button';
import { cx } from './cx';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** The resume consent screen wants a wide one; a confirmation wants a narrow one. */
  width?: 'sm' | 'md' | 'lg';
}

const WIDTH = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' } as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: ModalProps): ReactElement {
  const ref = useRef<HTMLDialogElement | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      const previous = opener.current;
      if (previous instanceof HTMLElement) previous.focus();
      opener.current = null;
    }
  }, [open]);

  const onCancel = useCallback(
    (event: SyntheticEvent<HTMLDialogElement>) => {
      // Escape must go through React state, or `open` and the DOM drift apart.
      event.preventDefault();
      onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={ref}
      onCancel={onCancel}
      aria-modal="true"
      className={cx(
        // `m-auto` is not cosmetic: Tailwind's preflight zeroes every margin, including the UA
        // stylesheet's `margin:auto` that is the only thing centring a top-layer <dialog>. Without
        // it every modal in the app pins itself to the top-left corner of the viewport.
        'm-auto w-[calc(100vw-2rem)] rounded-[var(--jf-radius)] border border-[var(--jf-border)] p-0',
        'bg-[var(--jf-surface)] text-[var(--jf-fg)] shadow-[var(--jf-shadow)]',
        'backdrop:bg-black/45',
        // Grows from its own centre when the top layer shows it — see `.jf-pop` in app.css.
        'jf-pop',
        WIDTH[width],
      )}
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--jf-border)] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description === undefined ? null : (
              <p className="mt-1 text-xs leading-relaxed text-[var(--jf-fg-muted)]">{description}</p>
            )}
          </div>
          {/* The Button already carries the accessible name, so the icon stays aria-hidden —
              labelling both would make a screen reader say "Close dialog" twice. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1.5 shrink-0"
          >
            <Close size={16} />
          </Button>
        </header>
        {/* A confirmation without a `confirmWord` passes `null` here; rendering the scroller
            anyway leaves ~40px of empty box between the question and its buttons. */}
        {children === undefined || children === null ? null : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        )}
        {footer === undefined ? null : (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--jf-border)] px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}

/**
 * Destructive confirmation. `confirmWord` forces the user to type something ("WIPE") before the
 * action arms — reserved for the SEC 9.2 wipe, which is genuinely unrecoverable.
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmWord,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  confirmWord?: string;
  busy?: boolean;
}): ReactElement {
  const [typed, setTyped] = useState('');

  // Every open starts from a blank confirmation — a leftover "WIPE" must never pre-arm the button.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const armed =
    confirmWord === undefined || typed.trim().toUpperCase() === confirmWord.toUpperCase();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={!armed} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {confirmWord === undefined ? null : (
        <label className="flex flex-col gap-1.5 text-xs text-[var(--jf-fg-muted)]">
          <span>
            Type <span className="font-mono font-semibold text-[var(--jf-fg)]">{confirmWord}</span>{' '}
            to confirm.
          </span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
            className="rounded-[var(--jf-radius-sm)] border border-[var(--jf-border-strong)] bg-[var(--jf-bg)] px-2.5 py-1.5 font-mono text-sm text-[var(--jf-fg)]"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
    </Modal>
  );
}
