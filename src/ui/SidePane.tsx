import { useId, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { PaneResizer } from './PaneResizer';
import { RAIL_WIDTH, type PaneControls, type PaneLayout, type PaneSide, type PaneState } from './panes';

/** CSS grid columns for the workspace, from the pane widths (side panes never take more than a share of the screen). */
export function gridColumns(layout: 'wide' | 'medium' | 'narrow', panes: PaneLayout): string | undefined {
  const col = (pane: PaneState, share: number) => (pane.collapsed ? `${RAIL_WIDTH}px` : `min(${pane.width}px, ${share}vw)`);
  if (layout === 'wide') return `${col(panes.left, 30)} minmax(0, 1fr) ${col(panes.right, 45)}`;
  if (layout === 'medium') return `minmax(0, 1fr) ${col(panes.right, 55)}`;
  return undefined;
}

interface Props {
  side: PaneSide;
  /** Name of the pane, used in its header and in the hide/show buttons. */
  title: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  state: PaneState;
  controls: PaneControls;
  resizeLabel: string;
  /** Replaces the default title in the header (e.g. tabs). */
  header?: ReactNode;
  children: ReactNode;
}

/** A collapsible, resizable side pane. When collapsed it shrinks to a strip with a button to show it again. */
export function SidePane({ side, title, icon: Icon, state, controls, resizeLabel, header, children }: Props) {
  const contentId = useId();
  const name = title.toLowerCase();
  const shortcut = side === 'left' ? '[' : ']';
  const HideIcon = side === 'left' ? ChevronLeftIcon : ChevronRightIcon;

  if (state.collapsed) {
    return (
      <aside className={`pane pane-${side} pane-collapsed`} aria-label={title}>
        <button
          type="button"
          className="pane-rail"
          aria-expanded={false}
          aria-label={`Show ${name} (${shortcut})`}
          title={`Show ${name} (${shortcut})`}
          onClick={() => controls.setCollapsed(side, false)}
        >
          <Icon />
        </button>
      </aside>
    );
  }

  return (
    <aside className={`pane pane-${side}`} aria-label={title}>
      <div className="pane-header">
        {side === 'right' && (
          <button
            type="button"
            className="icon-button icon-button-small"
            aria-expanded
            aria-controls={contentId}
            aria-label={`Hide ${name} (${shortcut})`}
            title={`Hide ${name} (${shortcut})`}
            onClick={() => controls.setCollapsed(side, true)}
          >
            <HideIcon />
          </button>
        )}
        <div className="pane-header-main">{header ?? <span className="pane-title">{title}</span>}</div>
        {side === 'left' && (
          <button
            type="button"
            className="icon-button icon-button-small"
            aria-expanded
            aria-controls={contentId}
            aria-label={`Hide ${name} (${shortcut})`}
            title={`Hide ${name} (${shortcut})`}
            onClick={() => controls.setCollapsed(side, true)}
          >
            <HideIcon />
          </button>
        )}
      </div>
      <div className="pane-content" id={contentId}>
        {children}
      </div>
      <PaneResizer
        side={side}
        width={state.width}
        label={resizeLabel}
        onResize={(width) => controls.setWidth(side, width)}
        onCollapse={() => controls.setCollapsed(side, true)}
        onReset={() => controls.reset(side)}
      />
    </aside>
  );
}
