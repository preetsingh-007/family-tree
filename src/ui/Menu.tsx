import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  description?: string;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  label: ReactNode;
  /** Accessible name when the label is only an icon. */
  ariaLabel?: string;
  items: (MenuItem | 'separator')[];
  buttonClassName?: string;
  align?: 'left' | 'right';
}

/** A menu button following the WAI-ARIA menu pattern (arrow keys, Escape, focus return). */
export function Menu({ label, ariaLabel, items, buttonClassName = 'button', align = 'left' }: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const itemElements = () => [...(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];

  useEffect(() => {
    if (!open) return;
    itemElements()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const elements = itemElements();
    const current = elements.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      elements[(current + 1) % elements.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      elements[(current - 1 + elements.length) % elements.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      elements[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      elements[elements.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
      </button>
      {open && (
        <div className={`menu menu-${align}`} role="menu" id={menuId} onKeyDown={onMenuKeyDown}>
          {items.map((item, i) =>
            item === 'separator' ? (
              <div key={`sep-${i}`} role="separator" className="menu-separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`menu-item ${item.danger ? 'danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.description && <span className="menu-item-description">{item.description}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
