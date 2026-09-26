import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { layoutTree, NODE_HEIGHT, NODE_WIDTH, type LayoutNode } from '../layout/treeLayout';
import { mediaDataUrl } from '../media/image';
import { displayName, initials, lifespan } from '../model/names';
import { getPortrait, type TreeIndex } from '../model/relatives';
import type { Id } from '../model/types';
import { FitIcon, TargetIcon, ZoomInIcon, ZoomOutIcon } from './icons';
import { nameLines } from './nodeLabel';

interface Props {
  index: TreeIndex;
  /** The person the layout is built around. */
  focusId?: Id;
  selectedId?: Id;
  onSelect: (id: Id) => void;
  onOpen: (id: Id) => void;
  onFocus: (id: Id) => void;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const RADIUS_OPTIONS: { value: number; label: string }[] = [
  { value: 2, label: 'Close family' },
  { value: 3, label: '3 steps' },
  { value: 4, label: '4 steps' },
  { value: 6, label: '6 steps' },
  { value: Infinity, label: 'Everyone' },
];

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export function TreeView({ index, focusId, selectedId, onSelect, onOpen, onFocus }: Props) {
  const instructionsId = useId();
  const clipId = `clip${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [radius, setRadius] = useState(3);
  const [view, setView] = useState<View>({ x: 400, y: 300, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; startX: number; startY: number; distance?: number; moved: boolean } | null>(null);

  const layout = useMemo(() => layoutTree(index, focusId, { radius }), [index, focusId, radius]);
  const nodesById = useMemo(() => new Map(layout.nodes.map((n) => [n.person.id, n])), [layout]);
  // The canvas is only rendered once the tree has people; effects that attach to it depend on this.
  const hasCanvas = index.people.size > 0;

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
    (node: LayoutNode | undefined, k?: number) => {
      if (!node) return;
      setView((v) => {
        const scale = k ?? v.k;
        return { k: scale, x: size.width / 2 - node.x * scale, y: size.height / 2 - node.y * scale };
      });
    },
    [size.width, size.height],
  );

  const fit = useCallback(() => {
    const { minX, minY, maxX, maxY } = layout.bounds;
    const w = maxX - minX + 80;
    const h = maxY - minY + 80;
    const k = clampZoom(Math.min(size.width / w, size.height / h, 1));
    setView({ k, x: size.width / 2 - ((minX + maxX) / 2) * k, y: size.height / 2 - ((minY + maxY) / 2) * k });
  }, [layout.bounds, size.width, size.height]);

  // Re-centre when the layout's focus changes, zoomed out as far as needed to
  // show the whole layout, but not so far that names become unreadable.
  const focusNode = focusId ? nodesById.get(focusId) : layout.nodes[0];
  useEffect(() => {
    const { minX, minY, maxX, maxY } = layout.bounds;
    const fitScale = Math.min(size.width / (maxX - minX + 80), size.height / (maxY - minY + 80));
    const k = Math.min(1, Math.max(0.6, fitScale));
    if (fitScale >= 0.6) fit();
    else centerOn(focusNode, k);
    // Only when the focus person or the layout itself changes, not on every view change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, radius, size.width, size.height]);

  // Keep the selected person visible.
  useEffect(() => {
    const node = selectedId ? nodesById.get(selectedId) : undefined;
    if (!node) return;
    const sx = node.x * view.k + view.x;
    const sy = node.y * view.k + view.y;
    const margin = 60;
    if (sx < margin || sy < margin || sx > size.width - margin || sy > size.height - margin) centerOn(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, nodesById]);

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

  const onPointerDown = (event: ReactPointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      gesture.current = { view, startX: event.clientX, startY: event.clientY, moved: false };
    } else if (pts.length === 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = {
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
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length === 1) {
      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
      if (g.moved) setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    } else if (pts.length === 2 && g.distance) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
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
    if (pointers.current.size === 0) {
      // Keep `moved` visible to the click handler that fires after pointerup.
      setTimeout(() => {
        gesture.current = null;
      }, 0);
    } else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { view, startX: p!.x, startY: p!.y, moved: true };
    }
  };

  const nodeClick = (id: Id) => {
    if (gesture.current?.moved) return;
    if (id === selectedId) onOpen(id);
    else onSelect(id);
  };

  const moveSelection = (event: KeyboardEvent, node: LayoutNode) => {
    const sameRow = layout.nodes.filter((n) => n.generation === node.generation).sort((a, b) => a.x - b.x);
    const nearestIn = (generation: number, preferred: Set<Id>) => {
      const candidates = layout.nodes.filter((n) => n.generation === generation);
      const pool = candidates.filter((n) => preferred.has(n.person.id));
      return (pool.length ? pool : candidates).sort((a, b) => Math.abs(a.x - node.x) - Math.abs(b.x - node.x))[0];
    };
    let target: LayoutNode | undefined;
    switch (event.key) {
      case 'ArrowLeft':
        target = sameRow[sameRow.indexOf(node) - 1];
        break;
      case 'ArrowRight':
        target = sameRow[sameRow.indexOf(node) + 1];
        break;
      case 'ArrowUp':
        target = nearestIn(node.generation - 1, new Set((index.linksByChild.get(node.person.id) ?? []).map((l) => l.parentId)));
        break;
      case 'ArrowDown':
        target = nearestIn(node.generation + 1, new Set((index.linksByParent.get(node.person.id) ?? []).map((l) => l.childId)));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onOpen(node.person.id);
        return;
      case 'f':
      case 'F':
        onFocus(node.person.id);
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
    el.querySelector<SVGGElement>(`[data-person-id="${CSS.escape(selectedId)}"]`)?.focus();
  }, [selectedId]);

  const tabStopId = selectedId && nodesById.has(selectedId) ? selectedId : focusNode?.person.id;

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
            if (selectedId === focusId) centerOn(nodesById.get(selectedId));
            else onFocus(selectedId);
          }}
        >
          <TargetIcon />
        </button>
      </div>
      <p id={instructionsId} className="visually-hidden">
        Family tree diagram. Use the arrow keys to move between people: up for parents, down for children, left and right
        along the same generation. Press Enter to open details, or F to re-centre the tree on the selected person. A list of
        all people is also available in the People panel.
      </p>
      <div
        ref={containerRef}
        className="tree-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <svg width="100%" height="100%" role="group" aria-label="Family tree" aria-describedby={instructionsId}>
          <defs>
            <clipPath id={clipId}>
              <circle r="20" cx="0" cy="0" />
            </clipPath>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            <g className="edges" aria-hidden="true">
              {layout.partnerEdges.map((e) => (
                <path key={e.id} d={e.path} className={`edge edge-partner ${e.ended ? 'edge-ended' : ''}`} />
              ))}
              {layout.childEdges.map((e) => (
                <path key={e.key} d={e.path} className={`edge edge-child ${e.dashed ? 'edge-dashed' : ''}`} />
              ))}
            </g>
            <g className="nodes">
              {layout.nodes.map((node) => {
                const { person } = node;
                const portrait = getPortrait(index, person);
                const selected = person.id === selectedId;
                const hidden = layout.hiddenRelatives.get(person.id);
                const name = displayName(person);
                const dates = lifespan(person);
                const lines = nameLines(name);
                return (
                  <g
                    key={person.id}
                    data-person-id={person.id}
                    className={`node ${selected ? 'selected' : ''} ${person.living === 'deceased' ? 'deceased' : ''} ${person.id === focusId ? 'focus' : ''}`}
                    transform={`translate(${node.x - NODE_WIDTH / 2},${node.y - NODE_HEIGHT / 2})`}
                    role="button"
                    tabIndex={person.id === tabStopId ? 0 : -1}
                    aria-label={`${name}${dates ? `, ${dates}` : ''}${hidden ? `, ${hidden} more relatives not shown` : ''}`}
                    aria-pressed={selected}
                    onClick={() => nodeClick(person.id)}
                    onKeyDown={(e) => moveSelection(e, node)}
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
                      {dates}
                    </text>
                    {hidden !== undefined && (
                      <g transform={`translate(${NODE_WIDTH - 12},${NODE_HEIGHT - 12})`} className="node-more">
                        <circle r="9" />
                        <text textAnchor="middle" dy="0.35em">
                          +
                        </text>
                      </g>
                    )}
                    <title>{name}</title>
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
          <span className="legend-more">+</span> more relatives: select, then centre the tree on them
        </span>
      </p>
    </div>
  );
}
