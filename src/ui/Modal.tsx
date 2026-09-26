import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'small' | 'medium' | 'large';
  /** Use role="alertdialog" for confirmations. */
  alert?: boolean;
  /** Prevent closing with Escape/backdrop while an operation is running. */
  busy?: boolean;
}

/**
 * Accessible modal dialog: focus moves into the dialog, Tab is trapped inside,
 * Escape closes it, and focus returns to the previously focused element.
 */
export function Modal({ title, onClose, children, footer, size = 'medium', alert, busy }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    const autofocus = dialog.querySelector<HTMLElement>('[data-autofocus]');
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE.split(', ').map((s) => `.modal-body ${s}`).join(', '));
    (autofocus ?? first ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = focusable[0]!;
      const lastEl = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal modal-${size}`}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="small"
      alert
      footer={
        <>
          <button type="button" className="button" onClick={onCancel} data-autofocus>
            Cancel
          </button>
          <button type="button" className={danger ? 'button button-danger' : 'button button-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
