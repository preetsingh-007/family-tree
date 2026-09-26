import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { PANE_LIMITS, SNAP_DISTANCE, type PaneSide } from './panes';

interface Props {
  side: PaneSide;
  width: number;
  /** Accessible name, e.g. "Resize people list". */
  label: string;
  onResize: (width: number) => void;
  onCollapse: () => void;
  onReset: () => void;
}

const STEP = 16;

/**
 * Draggable divider between a side pane and the tree (the WAI-ARIA "window
 * splitter" pattern): drag with a pointer, or focus it and use the arrow keys.
 * Dragging well past the minimum width collapses the pane; double-click resets it.
 */
export function PaneResizer({ side, width, label, onResize, onCollapse, onReset }: Props) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const { min, max } = PANE_LIMITS[side];
  // The left pane grows when dragging right; the right pane grows when dragging left.
  const direction = side === 'left' ? 1 : -1;

  const widthAt = (clientX: number) => drag.current!.startWidth + (clientX - drag.current!.startX) * direction;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    document.body.classList.add('resizing-panes');
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = widthAt(event.clientX);
    if (next >= min - SNAP_DISTANCE) onResize(next);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = widthAt(event.clientX);
    drag.current = null;
    document.body.classList.remove('resizing-panes');
    if (next < min - SNAP_DISTANCE) onCollapse();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === grow) onResize(width + STEP);
    else if (event.key === shrink) onResize(width - STEP);
    else if (event.key === 'Home') onResize(min);
    else if (event.key === 'End') onResize(max);
    else if (event.key === 'Enter') onCollapse();
    else return;
    event.preventDefault();
  };

  return (
    <div
      className={`pane-resizer pane-resizer-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels wide`}
      tabIndex={0}
      title="Drag to resize · double-click to reset · Enter to hide"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
