import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { layoutFocus } from '../layout/focusLayout';
import { layoutNetwork } from '../layout/networkLayout';
import { familyAnchor, routeLinks, type Point } from '../layout/routing';
import { boundsOf, NODE_HEIGHT, NODE_WIDTH, type LayoutNode, type TreeLayout } from '../layout/types';
import { mediaDataUrl } from '../media/image';
import { displayName, initials, lifespan } from '../model/names';
import { getPortrait, type TreeIndex } from '../model/relatives';
import type { Id } from '../model/types';
import { FitIcon, TargetIcon, UndoIcon, ZoomInIcon, ZoomOutIcon } from './icons';
import { nameLines } from './nodeLabel';

interface Props {
  index: TreeIndex;
  /** The person the layout is built around. */
  focusId?: Id;
  selectedId?: Id;
  onSelect: (id: Id) => void;
  onOpen: (id: Id) => void;
  onFocus: (id: Id) => void;
  /**
   * A person to bring into view, e.g. someone just added. If they are outside
   * the drawn part of the tree, the tree is re-centred on `fallbackFocus` once.
   * A new `token` starts a new request.
   */
  reveal?: RevealRequest;
}

export interface RevealRequest {
  id: Id;
  fallbackFocus: Id;
  token: number;
}

interface View {
  x: number;
  y: number;
  k: number;
}

/** Per-view choices: cleared when the tree is re-centred or the view setting changes. */
interface ViewChoices {
  key: string;
  expanded: ReadonlySet<Id>;
  /** Keys of families whose descendants are hidden. */
  collapsed: ReadonlySet<string>;
  /** Manual moves of boxes, by node key, in tree coordinates. */
  offsets: ReadonlyMap<string, Point>;
}

/** A press that has not moved yet ("pending"), or a pan of the whole view. */
type PressGesture = { kind: 'pending' | 'pan'; view: View; startX: number; startY: number; nodeKey?: string; touch: boolean; moved: boolean };

type Gesture =
  | PressGesture
  | { kind: 'drag'; startX: number; startY: number; keys: string[]; base: Map<string, Point>; k: number; moved: boolean }
  | { kind: 'pinch'; view: View; startX: number; startY: number; distance: number; moved: boolean };

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const LONG_PRESS_MS = 350;
const RADIUS_OPTIONS: { value: number; label: string }[] = [
  { value: 2, label: 'Close family' },
  { value: 3, label: '3 steps' },
  { value: 4, label: '4 steps' },
  { value: 6, label: '6 steps' },
  { value: Infinity, label: 'Everyone' },
];
const NO_OFFSET: Point = { x: 0, y: 0 };

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

function relativesLabel(count: number): string {
  return `${count} more ${count === 1 ? 'relative' : 'relatives'}`;
}

function computeLayout(
  index: TreeIndex,
  focusId: Id | undefined,
  radius: number,
  choices: Pick<ViewChoices, 'expanded' | 'collapsed'>,
): TreeLayout {
  const focus = focusId && index.people.has(focusId) ? focusId : index.tree.people[0]?.id;
  if (!focus) return layoutNetwork(index, undefined);
  return Number.isFinite(radius)
    ? layoutFocus(index, focus, { radius, expanded: choices.expanded, collapsed: choices.collapsed })
    : layoutNetwork(index, focus, { collapsed: choices.collapsed });
}

export function TreeView({ index, focusId, selectedId, onSelect, onOpen, onFocus, reveal }: Props) {
  const instructionsId = useId();
  const clipId = `clip${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [radius, setRadius] = useState(3);
  const [view, setView] = useState<View>({ x: 400, y: 300, k: 1 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout>>();

  // Expanded/collapsed people and moved boxes belong to one view (centre person + setting).
  const viewKey = `${focusId ?? ''}|${radius}`;
  const [storedChoices, setChoices] = useState<ViewChoices>({ key: viewKey, expanded: new Set(), collapsed: new Set(), offsets: new Map() });
  const choices = useMemo<ViewChoices>(
    () => (storedChoices.key === viewKey ? storedChoices : { key: viewKey, expanded: new Set(), collapsed: new Set(), offsets: new Map() }),
    [storedChoices, viewKey],
  );
  const updateChoices = useCallback(
    (change: (c: ViewChoices) => Partial<ViewChoices>) => setChoices({ ...choices, ...change(choices), key: viewKey }),
    [choices, viewKey],
  );
  const customised = choices.expanded.size > 0 || choices.collapsed.size > 0 || choices.offsets.size > 0;

  // Dragging only changes offsets, so it must not recompute the layout.
  const { expanded, collapsed } = choices;
  const layout = useMemo(
    () => computeLayout(index, focusId, radius, { expanded, collapsed }),
    [index, focusId, radius, expanded, collapsed],
  );
  const positioned = useMemo(
    () =>
      layout.nodes.map((n) => {
        const o = choices.offsets.get(n.key) ?? NO_OFFSET;
        return { ...n, x: n.x + o.x, y: n.y + o.y };
      }),
    [layout, choices.offsets],
  );
  const nodesByKey = useMemo(() => new Map(positioned.map((n) => [n.key, n])), [positioned]);
  const paths = useMemo(
    () => routeLinks(layout.partnerLinks, layout.familyLinks, (key) => nodesByKey.get(key)),
    [layout, nodesByKey],
  );
  const bounds = useMemo(() => boundsOf(positioned), [positioned]);
  // The canvas is only rendered once the tree has people; effects that attach to it depend on this.
  const hasCanvas = index.people.size > 0;

  // Lines that belong to the selected person are highlighted.
  const highlighted = useMemo(() => {
    const set = new Set<string>();
    if (!selectedId) return set;
    const isSelected = (key: string) => nodesByKey.get(key)?.person.id === selectedId;
    for (const l of layout.partnerLinks) if (isSelected(l.a) || isSelected(l.b)) set.add(l.key);
    for (const l of layout.familyLinks) {
      if (l.parents.some(isSelected) || l.children.some((c) => isSelected(c.key))) set.add(l.key);
    }
    return set;
  }, [layout, nodesByKey, selectedId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth || 800, height: el.clientHeight || 600 });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasCanvas]);

  const centerOn = useCallback(
    (node: Point | undefined, k?: number) => {
      if (!node) return;
      setView((v) => {
        const scale = k ?? v.k;
        return { k: scale, x: size.width / 2 - node.x * scale, y: size.height / 2 - node.y * scale };
      });
    },
    [size.width, size.height],
  );

  const fit = useCallback(() => {
    const { minX, minY, maxX, maxY } = bounds;
    const w = maxX - minX + 80;
    const h = maxY - minY + 80;
    const k = clampZoom(Math.min(size.width / w, size.height / h, 1));
    setView({ k, x: size.width / 2 - ((minX + maxX) / 2) * k, y: size.height / 2 - ((minY + maxY) / 2) * k });
  }, [bounds, size.width, size.height]);

  // Re-centre when the layout's focus changes, zoomed out as far as needed to
  // show the whole layout, but not so far that names become unreadable.
  const focusNode = (focusId && nodesByKey.get(focusId)) || positioned[0];
  useEffect(() => {
    const { minX, minY, maxX, maxY } = bounds;
    const fitScale = Math.min(size.width / (maxX - minX + 80), size.height / (maxY - minY + 80));
    const k = Math.min(1, Math.max(0.6, fitScale));
    if (fitScale >= 0.6) fit();
    else if (focusNode) {
      // Centre on the focus person horizontally; vertically, show as much of the family as
      // possible while keeping the focus person comfortably on screen.
      const reach = (size.height / 2 - NODE_HEIGHT - 40) / k;
      const middle = (minY + maxY) / 2;
      const y = Math.min(focusNode.y + reach, Math.max(focusNode.y - reach, middle));
      centerOn({ x: focusNode.x, y }, k);
    }
    // Only when the focus person or the view setting changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, radius, size.width, size.height]);

  /** Pans (keeping the zoom) so the node is on screen, if it is not already. */
  const ensureVisible = useCallback(
    (node: Point) => {
      setView((v) => {
        const sx = node.x * v.k + v.x;
        const sy = node.y * v.k + v.y;
        // The whole node box plus a little breathing room must be on screen.
        const mx = Math.min(16 + (NODE_WIDTH / 2) * v.k, size.width / 2);
        const my = Math.min(16 + (NODE_HEIGHT / 2) * v.k, size.height / 2);
        const visible = sx >= mx && sy >= my && sx <= size.width - mx && sy <= size.height - my;
        return visible ? v : { k: v.k, x: size.width / 2 - node.x * v.k, y: size.height / 2 - node.y * v.k };
      });
    },
    [size.width, size.height],
  );

  // Keep the selected person visible.
  useEffect(() => {
    const node = selectedId ? nodesByKey.get(selectedId) : undefined;
    if (node) ensureVisible(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, layout]);

  // Bring a requested person (typically someone just added) into view.
  const revealState = useRef<{ token: number; refocused: boolean; done: boolean }>();
  useEffect(() => {
    if (!reveal || !hasCanvas) return;
    if (revealState.current?.token !== reveal.token) {
      revealState.current = { token: reveal.token, refocused: false, done: false };
    }
    const state = revealState.current;
    if (state.done) return;
    const node = nodesByKey.get(reveal.id);
    if (node) {
      state.done = true;
      ensureVisible(node);
    } else if (!state.refocused && reveal.fallbackFocus !== focusId) {
      // Outside the drawn area: re-centre on the person they were added to.
      state.refocused = true;
      onFocus(reveal.fallbackFocus);
    } else {
      state.done = true;
    }
  }, [reveal, hasCanvas, nodesByKey, focusId, onFocus, ensureVisible]);

  // After expanding someone in place, centre them once the new layout is drawn.
  const centreAfterLayout = useRef<Id>();
  useEffect(() => {
    const id = centreAfterLayout.current;
    if (!id) return;
    centreAfterLayout.current = undefined;
    centerOn(nodesByKey.get(id));
  }, [nodesByKey, centerOn]);

  const zoomAt = (factor: number, cx = size.width / 2, cy = size.height / 2) => {
    setView((v) => {
      const k = clampZoom(v.k * factor);
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };

  // Wheel zoom (non-passive so the page does not scroll).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      setView((v) => {
        const k = clampZoom(v.k * factor);
        return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasCanvas]);

  // --- Expanding and collapsing ------------------------------------------------------------

  /**
   * Shows a person's hidden relatives in place and pans to put them in the middle
   * of the screen; if that cannot be done here, re-centres the tree on them.
   */
  const expand = (id: Id) => {
    const before = layout.hiddenRelatives.get(id) ?? 0;
    if (Number.isFinite(radius) && !choices.expanded.has(id)) {
      const trial = { ...choices, expanded: new Set([...choices.expanded, id]) };
      const after = computeLayout(index, focusId, radius, trial).hiddenRelatives.get(id) ?? 0;
      if (after < before) {
        centreAfterLayout.current = id;
        updateChoices(() => ({ expanded: trial.expanded }));
        return;
      }
    }
    onFocus(id);
  };

  const toggleFamily = (key: string) => {
    const collapsed = new Set(choices.collapsed);
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    updateChoices(() => ({ collapsed }));
  };

  /** Keyboard: hide all of a person's families with children shown, or show them again. */
  const toggleFamiliesOf = (id: Id) => {
    const isParent = (keys: string[]) => keys.some((k) => nodesByKey.get(k)?.person.id === id);
    const hiddenOnes = layout.collapsedFamilies.filter((f) => isParent(f.parents)).map((f) => f.key);
    const collapsed = new Set(choices.collapsed);
    if (hiddenOnes.length) hiddenOnes.forEach((k) => collapsed.delete(k));
    else layout.familyLinks.filter((f) => f.children.length && isParent(f.parents)).forEach((f) => collapsed.add(f.key));
    updateChoices(() => ({ collapsed }));
  };

  /** Where a family's collapse control sits: on its line, just below the parents. */
  const controlPoint = (parentKeys: string[], joined: boolean): Point | undefined => {
    const parents = parentKeys.map((k) => nodesByKey.get(k)).filter((p): p is (typeof positioned)[number] => !!p);
    if (!parents.length) return undefined;
    const anchor = familyAnchor(parents, joined);
    return { x: anchor.x, y: Math.max(...parents.map((p) => p.y)) + NODE_HEIGHT / 2 + 16 };
  };
  const familyNames = (parentKeys: string[]) =>
    [...new Set(parentKeys.map((k) => nodesByKey.get(k)).filter((n) => !!n).map((n) => displayName(n!.person)))].join(' and ');

  // --- Pointer gestures: pan, pinch-zoom, and dragging boxes --------------------------------

  /** A box moves together with the partners drawn right next to it. */
  const dragGroup = (key: string): string[] => {
    const group = new Set([key]);
    for (const l of layout.partnerLinks) {
      if (!l.adjacent) continue;
      if (l.a === key) group.add(l.b);
      if (l.b === key) group.add(l.a);
    }
    return [...group];
  };

  const startDrag = (g: PressGesture) => {
    if (!g.nodeKey) return;
    const keys = dragGroup(g.nodeKey);
    gesture.current = {
      kind: 'drag',
      startX: g.startX,
      startY: g.startY,
      keys,
      base: new Map(keys.map((k) => [k, choices.offsets.get(k) ?? NO_OFFSET])),
      k: view.k,
      moved: true,
    };
    containerRef.current?.classList.add('dragging-node');
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    if ((event.target as Element).closest('.node-control')) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pts = [...pointers.current.values()];
    clearTimeout(longPress.current);
    if (pts.length === 1) {
      const nodeKey = (event.target as Element).closest('[data-node-key]')?.getAttribute('data-node-key') ?? undefined;
      const touch = event.pointerType === 'touch';
      const pending: PressGesture = { kind: 'pending', view, startX: event.clientX, startY: event.clientY, nodeKey, touch, moved: false };
      gesture.current = pending;
      // On touch screens a box is dragged after pressing and holding it, so swiping still pans.
      if (touch && nodeKey) {
        longPress.current = setTimeout(() => {
          if (gesture.current === pending) startDrag(pending);
        }, LONG_PRESS_MS);
      }
    } else if (pts.length === 2) {
      const [a, b] = pts as [Point, Point];
      gesture.current = {
        kind: 'pinch',
        view,
        startX: (a.x + b.x) / 2,
        startY: (a.y + b.y) / 2,
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        moved: true,
      };
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    let g = gesture.current;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (g.kind === 'pending') {
      if (Math.abs(dx) + Math.abs(dy) <= 4) return;
      clearTimeout(longPress.current);
      if (g.nodeKey && !g.touch) startDrag(g);
      else gesture.current = { ...g, kind: 'pan', moved: true };
      containerRef.current?.setPointerCapture?.(event.pointerId);
      // Apply this first movement too.
      g = gesture.current!;
    }
    if (g.kind === 'pan') {
      setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    } else if (g.kind === 'drag') {
      const offsets = new Map(choices.offsets);
      for (const key of g.keys) {
        const base = g.base.get(key)!;
        offsets.set(key, { x: base.x + dx / g.k, y: base.y + dy / g.k });
      }
      updateChoices(() => ({ offsets }));
    } else if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts as [Point, Point];
      const rect = containerRef.current!.getBoundingClientRect();
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const k = clampZoom(g.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.distance));
      const ox = g.startX - rect.left;
      const oy = g.startY - rect.top;
      setView({
        k,
        x: ox - ((ox - g.view.x) * k) / g.view.k + (midX - g.startX),
        y: oy - ((oy - g.view.y) * k) / g.view.k + (midY - g.startY),
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    clearTimeout(longPress.current);
    containerRef.current?.classList.remove('dragging-node');
    if (pointers.current.size === 0) {
      // Keep `moved` visible to the click handler that fires after pointerup.
      setTimeout(() => {
        gesture.current = null;
      }, 0);
    } else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { kind: 'pan', view, startX: p!.x, startY: p!.y, touch: true, moved: true };
    }
  };

  const nodeClick = (node: LayoutNode) => {
    if (gesture.current?.moved) return;
    if (node.echo) {
      // An echo stands in for someone drawn elsewhere: go to them.
      onSelect(node.person.id);
      const main = nodesByKey.get(node.person.id);
      if (main) ensureVisible(main);
      return;
    }
    if (node.person.id === selectedId) onOpen(node.person.id);
    else onSelect(node.person.id);
  };

  const mainNodes = useMemo(() => positioned.filter((n) => !n.echo), [positioned]);

  const onNodeKeyDown = (event: KeyboardEvent, node: LayoutNode) => {
    const id = node.person.id;
    const sameRow = mainNodes.filter((n) => n.generation === node.generation).sort((a, b) => a.x - b.x);
    const nearestIn = (generation: number, preferred: Set<Id>) => {
      const candidates = mainNodes.filter((n) => n.generation === generation);
      const pool = candidates.filter((n) => preferred.has(n.person.id));
      return (pool.length ? pool : candidates).sort((a, b) => Math.abs(a.x - node.x) - Math.abs(b.x - node.x))[0];
    };
    let target: LayoutNode | undefined;
    switch (event.key) {
      case 'ArrowLeft':
        target = sameRow[sameRow.findIndex((n) => n.key === node.key) - 1];
        break;
      case 'ArrowRight':
        target = sameRow[sameRow.findIndex((n) => n.key === node.key) + 1];
        break;
      case 'ArrowUp':
        target = nearestIn(node.generation - 1, new Set((index.linksByChild.get(id) ?? []).map((l) => l.parentId)));
        break;
      case 'ArrowDown':
        target = nearestIn(node.generation + 1, new Set((index.linksByParent.get(id) ?? []).map((l) => l.childId)));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onOpen(id);
        return;
      case 'f':
      case 'F':
        onFocus(id);
        return;
      case '+':
      case '=':
        if (layout.hiddenRelatives.has(id)) expand(id);
        return;
      case '-':
        toggleFamiliesOf(id);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (target) onSelect(target.person.id);
  };

  // Move DOM focus with the selection when the tree has keyboard focus.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !selectedId || !el.contains(document.activeElement)) return;
    el.querySelector<SVGGElement>(`[data-node-key="${CSS.escape(selectedId)}"]`)?.focus();
  }, [selectedId]);

  const tabStopKey = selectedId && nodesByKey.has(selectedId) ? selectedId : focusNode?.key;

  if (!hasCanvas) {
    return (
      <div className="tree-empty">
        <p>Your tree is empty. Add the first person to begin.</p>
      </div>
    );
  }

  return (
    <div className="tree-view">
      <div className="tree-controls" role="toolbar" aria-label="Tree view controls">
        <label className="tree-radius">
          <span className="visually-hidden">How much of the family to show</span>
          <select className="input input-small" value={String(radius)} onChange={(e) => setRadius(Number(e.target.value))}>
            {RADIUS_OPTIONS.map((o) => (
              <option key={o.label} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomAt(1.25)}>
          <ZoomInIcon />
        </button>
        <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomAt(0.8)}>
          <ZoomOutIcon />
        </button>
        <button type="button" className="icon-button" aria-label="Fit tree to screen" title="Fit to screen" onClick={fit}>
          <FitIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Centre the tree on the selected person"
          title="Centre the tree on the selected person"
          disabled={!selectedId}
          onClick={() => {
            if (!selectedId) return;
            if (selectedId === focusId) centerOn(nodesByKey.get(selectedId));
            else onFocus(selectedId);
          }}
        >
          <TargetIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Reset view (undo expanding, collapsing and moving)"
          title="Reset view"
          disabled={!customised}
          onClick={() => updateChoices(() => ({ expanded: new Set(), collapsed: new Set(), offsets: new Map() }))}
        >
          <UndoIcon />
        </button>
      </div>
      <p id={instructionsId} className="visually-hidden">
        Family tree diagram. Use the arrow keys to move between people: up for parents, down for children, left and right
        along the same generation. Press Enter to open details, F to centre the tree on the selected person, plus to show
        their hidden relatives, and minus to hide or show their descendants. Boxes can be dragged to rearrange them. A list
        of all people is also available in the People panel.
      </p>
      <div
        ref={containerRef}
        className="tree-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg width="100%" height="100%" role="group" aria-label="Family tree" aria-describedby={instructionsId}>
          <defs>
            <clipPath id={clipId}>
              <circle r="20" cx="0" cy="0" />
            </clipPath>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`} className={selectedId ? 'has-selection' : undefined}>
            <g className="edges" aria-hidden="true">
              {paths.map((p) => (
                <path
                  key={p.key}
                  d={p.d}
                  className={[
                    'edge',
                    p.kind === 'partner' ? 'edge-partner' : 'edge-child',
                    p.ended ? 'edge-ended' : '',
                    p.dashed ? 'edge-dashed' : '',
                    highlighted.has(p.link) ? 'edge-highlight' : '',
                  ].join(' ')}
                />
              ))}
            </g>
            <g className="nodes">
              {positioned.map((node) => {
                const { person } = node;
                const portrait = getPortrait(index, person);
                const selected = !node.echo && person.id === selectedId;
                const hidden = node.echo ? undefined : layout.hiddenRelatives.get(person.id);
                const name = displayName(person);
                const dates = lifespan(person);
                const lines = nameLines(name);
                const label = node.echo
                  ? `${name}, shown elsewhere in the tree`
                  : `${name}${dates ? `, ${dates}` : ''}${hidden ? `, ${relativesLabel(hidden)} not shown (press plus to show them)` : ''}`;
                return (
                  <g
                    key={node.key}
                    data-node-key={node.key}
                    className={`node ${selected ? 'selected' : ''} ${person.living === 'deceased' ? 'deceased' : ''} ${node.echo ? 'echo' : ''}`}
                    transform={`translate(${node.x - NODE_WIDTH / 2},${node.y - NODE_HEIGHT / 2})`}
                    role="button"
                    tabIndex={!node.echo && node.key === tabStopKey ? 0 : -1}
                    aria-label={label}
                    aria-pressed={node.echo ? undefined : selected}
                    onClick={() => nodeClick(node)}
                    onKeyDown={(e) => !node.echo && onNodeKeyDown(e, node)}
                  >
                    <rect className="node-box" width={NODE_WIDTH} height={NODE_HEIGHT} rx="10" />
                    <g transform="translate(30,32)">
                      <circle r="20" className="node-avatar" />
                      {portrait ? (
                        <image
                          href={mediaDataUrl(portrait)}
                          x="-20"
                          y="-20"
                          width="40"
                          height="40"
                          clipPath={`url(#${clipId})`}
                          preserveAspectRatio="xMidYMid slice"
                        />
                      ) : (
                        <text className="node-initials" textAnchor="middle" dy="0.35em">
                          {initials(person)}
                        </text>
                      )}
                    </g>
                    {lines.map((line, i) => (
                      <text key={i} className="node-name" x="58" y={lines.length === 1 ? 28 : 21 + i * 16}>
                        {line}
                      </text>
                    ))}
                    <text className="node-dates" x="58" y={lines.length === 1 ? 46 : 54}>
                      {node.echo ? 'shown elsewhere ↗' : dates}
                    </text>
                    <title>{node.echo ? `${name} (shown elsewhere in the tree)` : name}</title>
                  </g>
                );
              })}
            </g>
            {/* Controls on the boxes: separate buttons, not nested inside the box buttons. */}
            <g className="node-controls">
              {positioned.map((node) => {
                if (node.echo) return null;
                const id = node.person.id;
                const name = displayName(node.person);
                const hidden = layout.hiddenRelatives.get(id);
                const controls = [];
                if (hidden !== undefined) {
                  const label = `Show ${relativesLabel(hidden)} of ${name}`;
                  controls.push(
                    <g
                      key="more"
                      className="node-control node-more"
                      transform={`translate(${node.x + NODE_WIDTH / 2 - 4},${node.y - NODE_HEIGHT / 2 + 4})`}
                      role="button"
                      tabIndex={-1}
                      aria-label={label}
                      onClick={() => expand(id)}
                    >
                      <circle r="13" />
                      <text textAnchor="middle" dy="0.35em">
                        +
                      </text>
                      <title>{label}</title>
                    </g>,
                  );
                }
                return controls.length ? <g key={node.key}>{controls}</g> : null;
              })}
              {/* One control per family, on its line below the parents: hide or show the descendants. */}
              {layout.familyLinks.map((family) => {
                if (!family.children.length) return null;
                const at = controlPoint(family.parents, family.joined);
                if (!at) return null;
                const label = `Hide descendants of ${familyNames(family.parents)}`;
                return (
                  <g
                    key={`collapse-${family.key}`}
                    className="node-control node-collapse"
                    transform={`translate(${at.x},${at.y})`}
                    role="button"
                    tabIndex={-1}
                    aria-label={label}
                    onClick={() => toggleFamily(family.key)}
                  >
                    <circle r="10" />
                    <text textAnchor="middle" dy="0.35em">
                      −
                    </text>
                    <title>{label}</title>
                  </g>
                );
              })}
              {layout.collapsedFamilies.map((family) => {
                const at = controlPoint(family.parents, family.parents.length > 1);
                if (!at) return null;
                const label = `Show ${family.hidden} hidden descendant${family.hidden === 1 ? '' : 's'} of ${familyNames(family.parents)}`;
                return (
                  <g
                    key={`expand-${family.key}`}
                    className="node-control node-collapsed"
                    transform={`translate(${at.x},${at.y})`}
                    role="button"
                    tabIndex={-1}
                    aria-label={label}
                    onClick={() => toggleFamily(family.key)}
                  >
                    <rect x="-22" y="-11" width="44" height="22" rx="11" />
                    <text textAnchor="middle" dy="0.35em">{`+${family.hidden}`}</text>
                    <title>{label}</title>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      </div>
      <p className="tree-legend" aria-hidden="true">
        <span>
          <svg width="28" height="8">
            <path d="M0,4H28" className="edge" />
          </svg>
          birth / partner
        </span>
        <span>
          <svg width="28" height="8">
            <path d="M0,4H28" className="edge edge-dashed" />
          </svg>
          adoptive, step, foster
        </span>
        <span>
          <span className="legend-more">+</span> show more relatives
        </span>
        <span>
          <span className="legend-echo" /> shown elsewhere
        </span>
      </p>
    </div>
  );
}
