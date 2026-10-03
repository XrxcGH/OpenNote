// A pane splitter (ARCHITECTURE.md section 11.3), following the APG window splitter pattern: a focusable
// separator with its value in pixels. Arrows resize by 8 px (40 with Shift), Home and End go to the limits, Enter
// collapses or expands, a double-click resets, and right-click, long press, Shift+F10, or the Menu key open a menu
// with the same actions, so no resize needs a drag (WCAG 2.5.7).
//
// Dragging uses pointer capture and writes a CSS variable once per animation frame, with no React render; the
// width is saved on release. Dragging 40 px past the minimum collapses the pane to its rail.

import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { commandContext } from '../../commands/registry';
import { menuItemsFor } from '../../commands/menus';
import { useLayout } from '../../state/layout';
import { sessionStore } from '../../state/session';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { tokens } from '../../theme/tokens';
import { useContextMenu } from '../../ui';
import { resetPane, resizePane, RESIZE_STEP, setPaneShowing, setPaneWidth, togglePane } from './paneActions';
import { clampPaneWidth, paneBounds } from './solvePanes';
import type { PaneId } from './solvePanes';
import styles from './Workspace.module.css';

/** The arrow-key step. */
const KEY_STEP = 8;
/** How far past the minimum a drag must go to collapse the pane. */
const COLLAPSE_PAST = 40;

const LABELS = {
  notebooks: { name: 'layout.splitter.notebooks', menu: 'layout.splitter.notebooksMenu' },
  pages: { name: 'layout.splitter.pages', menu: 'layout.splitter.pagesMenu' },
} as const;

function valueText(pane: PaneId, width: number, collapsed: boolean): string {
  if (collapsed) return t(pane === 'notebooks' ? 'layout.announce.notebooksHidden' : 'layout.announce.pagesHidden');
  return pane === 'notebooks'
    ? t('layout.splitter.notebooksValue', { width })
    : t('layout.splitter.pagesValue', { width });
}

interface Drag {
  pointer: number;
  startX: number;
  startWidth: number;
  min: number;
  max: number;
  width: number;
  collapse: boolean;
  frame: number;
  rtl: boolean;
  workspace: HTMLElement | null;
}

/** The width a drag shows now, and whether letting go would collapse the pane. */
function dragTarget(drag: Drag, clientX: number, collapsed: boolean) {
  const raw = drag.startWidth + (clientX - drag.startX) * (drag.rtl ? -1 : 1);
  const collapse = collapsed ? raw < tokens.size.rail + COLLAPSE_PAST : raw < drag.min - COLLAPSE_PAST;
  return { collapse, width: Math.round(Math.min(drag.max, Math.max(drag.min, raw))) };
}

function useSplitterDrag(pane: PaneId, collapsed: boolean) {
  const drag = useRef<Drag | null>(null);
  const variable = `--pane-${pane}-drag`;
  const paint = (current: Drag, separator: HTMLElement) => {
    current.frame = 0;
    const shown = current.collapse ? tokens.size.rail : current.width;
    current.workspace?.style.setProperty(variable, `${shown}px`);
    separator.setAttribute('aria-valuenow', String(current.collapse ? current.min : current.width));
  };
  const end = (event: PointerEvent<HTMLElement>, commit: boolean) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(current.frame);
    current.workspace?.style.removeProperty(variable);
    delete event.currentTarget.dataset.dragging;
    // A click, or a drag back to where it started, changes nothing.
    if (!commit || (current.collapse === collapsed && (collapsed || current.width === current.startWidth))) return;
    if (current.collapse) void setPaneShowing(pane, false, false);
    else if (collapsed) void setPaneShowing(pane, true, false).then(() => setPaneWidth(pane, current.width));
    else setPaneWidth(pane, current.width);
  };
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      const separator = event.currentTarget;
      try {
        separator.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that is no longer down can't be captured; the drag then follows the splitter's own events.
      }
      separator.dataset.dragging = 'true';
      const startWidth = collapsed ? tokens.size.rail : Number(separator.getAttribute('aria-valuenow'));
      drag.current = {
        pointer: event.pointerId,
        startX: event.clientX,
        startWidth,
        min: Number(separator.dataset.min),
        max: Number(separator.dataset.max),
        width: startWidth,
        collapse: collapsed,
        frame: 0,
        rtl: getComputedStyle(separator).direction === 'rtl',
        workspace: separator.closest<HTMLElement>('[data-workspace]'),
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      Object.assign(current, dragTarget(current, event.clientX, collapsed));
      const separator = event.currentTarget;
      if (!current.frame) current.frame = requestAnimationFrame(() => paint(current, separator));
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => end(event, true),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, false),
  };
}

function useSplitterKeys(pane: PaneId, bounds: { min: number; max: number }) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = event.shiftKey ? RESIZE_STEP : KEY_STEP;
    const grow: Record<string, number> = { ArrowRight: rtl ? -step : step, ArrowLeft: rtl ? step : -step };
    if (event.key in grow) resizePane(pane, grow[event.key]);
    else if (event.key === 'Home' && !event.shiftKey) setPaneWidth(pane, bounds.min);
    else if (event.key === 'End' && !event.shiftKey) setPaneWidth(pane, bounds.max);
    else if (event.key === 'Enter' && !event.shiftKey) void togglePane(pane, false);
    else return;
    event.preventDefault();
  };
}

export function Splitter({ pane, controls }: { pane: PaneId; controls: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prefs = useStore(sessionStore, (state) => state.panes);
  const { width: windowWidth, sizeClass } = useLayout((state) => state);
  const bounds = paneBounds(pane, windowWidth, sizeClass, prefs);
  const collapsed = prefs[pane].collapsed;
  const width = Math.min(bounds.max, clampPaneWidth(pane, prefs[pane].width));
  const drag = useSplitterDrag(pane, collapsed);
  const onKeyDown = useSplitterKeys(pane, bounds);
  useContextMenu(ref, () => ({
    label: t(LABELS[pane].menu),
    items: menuItemsFor(`splitter.${pane}`, commandContext('menu', { kind: 'splitter', pane })),
  }));
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-controls={controls}
      aria-label={t(LABELS[pane].name)}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={collapsed ? bounds.min : width}
      aria-valuetext={valueText(pane, width, collapsed)}
      data-min={bounds.min}
      data-max={bounds.max}
      tabIndex={0}
      className={styles.splitter}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        resetPane(pane);
        if (collapsed) void setPaneShowing(pane, true, false);
      }}
      {...drag}
    />
  );
}
