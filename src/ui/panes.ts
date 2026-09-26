/**
 * Widths and collapsed state of the workspace side panes.
 *
 * This is a display preference only (no family data), remembered in
 * localStorage so the layout survives reloads. Storage failures (private
 * browsing, disabled storage) fall back to defaults silently.
 */
import { useCallback, useEffect, useState } from 'react';

export type PaneSide = 'left' | 'right';

export interface PaneState {
  width: number;
  collapsed: boolean;
}

export type PaneLayout = Record<PaneSide, PaneState>;

export const PANE_LIMITS: Record<PaneSide, { min: number; max: number; default: number }> = {
  left: { min: 200, max: 480, default: 300 },
  right: { min: 320, max: 680, default: 420 },
};

/** Width of a collapsed pane's icon strip. */
export const RAIL_WIDTH = 44;
/** Dragging this far below the minimum width collapses the pane. */
export const SNAP_DISTANCE = 80;

const STORAGE_KEY = 'family-tree.ui.panes.v1';

export const DEFAULT_PANES: PaneLayout = {
  left: { width: PANE_LIMITS.left.default, collapsed: false },
  right: { width: PANE_LIMITS.right.default, collapsed: false },
};

export function clampWidth(side: PaneSide, width: number): number {
  const { min, max } = PANE_LIMITS[side];
  return Math.round(Math.min(max, Math.max(min, width)));
}

function sanitize(value: unknown): PaneLayout {
  const result = structuredClone(DEFAULT_PANES);
  if (typeof value !== 'object' || value === null) return result;
  for (const side of ['left', 'right'] as const) {
    const pane = (value as Record<string, unknown>)[side];
    if (typeof pane !== 'object' || pane === null) continue;
    const { width, collapsed } = pane as Record<string, unknown>;
    if (typeof width === 'number' && Number.isFinite(width)) result[side].width = clampWidth(side, width);
    if (typeof collapsed === 'boolean') result[side].collapsed = collapsed;
  }
  return result;
}

export function loadPanes(): PaneLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : structuredClone(DEFAULT_PANES);
  } catch {
    return structuredClone(DEFAULT_PANES);
  }
}

function savePanes(panes: PaneLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panes));
  } catch {
    // Not being able to remember a display preference is harmless.
  }
}

export interface PaneControls {
  panes: PaneLayout;
  setWidth: (side: PaneSide, width: number) => void;
  setCollapsed: (side: PaneSide, collapsed: boolean) => void;
  toggle: (side: PaneSide) => void;
  reset: (side: PaneSide) => void;
}

export function usePanes(): PaneControls {
  const [panes, setPanes] = useState<PaneLayout>(loadPanes);
  useEffect(() => savePanes(panes), [panes]);

  const update = useCallback((side: PaneSide, patch: Partial<PaneState>) => {
    setPanes((current) => {
      const next = { ...current[side], ...patch };
      if (next.width === current[side].width && next.collapsed === current[side].collapsed) return current;
      return { ...current, [side]: next };
    });
  }, []);

  return {
    panes,
    setWidth: useCallback((side, width) => update(side, { width: clampWidth(side, width), collapsed: false }), [update]),
    setCollapsed: useCallback((side, collapsed) => update(side, { collapsed }), [update]),
    toggle: useCallback((side) => setPanes((c) => ({ ...c, [side]: { ...c[side], collapsed: !c[side].collapsed } })), []),
    reset: useCallback((side) => update(side, { width: PANE_LIMITS[side].default, collapsed: false }), [update]),
  };
}
