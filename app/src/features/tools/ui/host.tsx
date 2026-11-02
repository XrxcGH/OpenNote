// The tool windows (Phase 10), opened from the command palette. In the app they dock beside the page; "Open in its
// own window" moves one to a window of its own, where the app can make one. Opening a tool that is already open
// brings it forward. The layer mounts on first use, so nothing here costs anything until a tool is opened.
import { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { createStore, useStore } from '../../../state/store';
import { CalculatorTool } from './CalculatorTool';
import { TimersTool } from './TimersTool';
import { ExtraToolBody } from './extraTools';
import { dockInsetOf, setDockInset } from '../../../shell/layout/dock';
import { MIN_PANEL, ToolWindow } from './ToolWindow';
import styles from './tools.module.css';
import { UpcomingTool } from './UpcomingTool';
import { forgetStored, loadStored, saveStored } from './storage';
import { TOOLS } from './tools';
import type { ToolId } from './tools';
import { FLOAT_GAP, placeWindows } from './windowPlacement';

interface Layer {
  open: readonly ToolId[];
  /** The tools kept above the others. */
  pinned: readonly ToolId[];
  /** Counts the times the windows were reset, so each draws again at its first place. */
  epoch: number;
  /** The widths the person dragged panels to this session. */
  widths: Readonly<Partial<Record<ToolId, number>>>;
  /** The windows in the order they were last used, the most recent last. Floating windows that overlap stack in it. */
  used: readonly ToolId[];
}

const layer = createStore<Layer>({ open: [], pinned: [], epoch: 0, widths: {}, used: [] }, 'tool windows');
let root: Root | null = null;

export function ToolBody({ tool }: { tool: ToolId }) {
  if (tool === 'timers') return <TimersTool />;
  if (tool === 'calculator') return <CalculatorTool />;
  if (tool === 'upcoming') return <UpcomingTool />;
  return <ExtraToolBody tool={tool} />;
}

/** True where the app can open a window of its own for a tool. */
export const canPopOut = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function popOut(tool: ToolId, pinned: boolean): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tool_window_open', { tool, pinned });
    closeTool(tool);
  } catch {
    // The tool stays where it is.
  }
}

/** The least width the page keeps beside docked panels. Below it the panels overlay the page from the right edge. */
export const MIN_PAGE = 480;

const widthOf = (state: Layer, id: ToolId): number =>
  state.widths[id] ?? loadStored<number>(`width.${id}`, TOOLS.find((one) => one.id === id)!.width);

const pageViewport = () => document.querySelector<HTMLElement>('[data-scope=page][class*=viewport]');

/** The width of the page's scroll bar (a styled one differs from the browser's own), 0 where bars float over the content. */
function scrollbarSize(): number {
  const page = pageViewport();
  if (page && page.offsetWidth > page.clientWidth) return page.offsetWidth - page.clientWidth;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:100px;block-size:100px;overflow:scroll';
  document.body.append(probe);
  const size = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return size;
}

/** Puts a window above the others it overlaps. */
function raise(id: ToolId): void {
  layer.set((current) =>
    current.used.at(-1) === id ? current : { ...current, used: [...current.used.filter((one) => one !== id), id] },
  );
}

/** Re-renders when the window or the page region changes size, so the windows follow the panes. */
function useLayoutSize(): number {
  const [viewport, setViewport] = useState(window.innerWidth);
  const [, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    const main = document.querySelector('main');
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => setTick((n) => n + 1));
    if (main) observer?.observe(main);
    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, []);
  return viewport;
}

function Windows() {
  const state = useStore(layer, (current) => current);
  const viewport = useLayoutSize();
  const widths = state.open.map((id) => widthOf(state, id));
  // The page region's left edge does not move when panels dock, so it says how much room the panels may take.
  // A hidden page region (the compact layout showing a pane) has no box: the windows then go by the window alone.
  const region = document.querySelector('main')?.getBoundingClientRect();
  const main = region && region.width > 0 ? region : undefined;
  const pageLeft = Math.max(0, main?.left ?? 0);
  // Floating windows keep clear of the page's scroll bar and of anything at the page region's right edge, such as a
  // sheet. The bar is where the page's scroller has it, which a pane beside the page moves in from the edge.
  let track = (main?.right ?? viewport) + dockInsetOf('tools') - scrollbarSize();
  const scroller = pageViewport();
  const box = scroller?.getBoundingClientRect();
  if (scroller && box && box.width > 0) track = Math.min(track, box.left + scroller.clientLeft + scroller.clientWidth);
  const edge = Math.max(0, viewport - track);
  const placement = placeWindows({ widths, viewport, room: viewport - pageLeft - MIN_PAGE, edge });
  const { overlay, docked } = placement;
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--scrollbar-size', `${scrollbarSize()}px`);
  });
  useLayoutEffect(() => {
    setDockInset(docked);
    return () => setDockInset(0);
  }, [docked]);
  const stack = (id: ToolId) => {
    const used = state.used.indexOf(id);
    return 1 + (used < 0 ? 0 : used) + (state.pinned.includes(id) ? state.open.length : 0);
  };
  return (
    <>
      {state.open.map((id, index) => {
        const tool = TOOLS.find((one) => one.id === id)!;
        const pinned = state.pinned.includes(id);
        const placed = placement.windows[index]!;
        const others = docked - widths[index]!;
        return (
          <ToolWindow
            key={`${id}-${state.epoch}`}
            tool={tool}
            width={placed.width}
            right={placed.right}
            down={placed.down}
            overlay={overlay}
            stack={stack(id)}
            maxWidth={
              overlay ? viewport - edge - 2 * FLOAT_GAP : Math.max(MIN_PANEL, viewport - pageLeft - MIN_PAGE - others)
            }
            onResize={(width) => {
              saveStored(`width.${id}`, width);
              layer.set((current) => ({ ...current, widths: { ...current.widths, [id]: width } }));
            }}
            onRaise={() => raise(id)}
            pinned={pinned}
            onPin={() =>
              layer.set((current) => ({
                ...current,
                pinned: pinned ? current.pinned.filter((one) => one !== id) : [...current.pinned, id],
              }))
            }
            onClose={() => closeTool(id)}
            {...(canPopOut() ? { onPopOut: () => void popOut(id, pinned) } : {})}
          >
            <ToolBody tool={id} />
          </ToolWindow>
        );
      })}
    </>
  );
}

/** Brings a tool's own window forward when the app has one open. True when it did. */
async function focusPopped(id: ToolId): Promise<boolean> {
  try {
    const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow');
    if (!(await getAllWebviewWindows()).some((one) => one.label === `tool-${id}`)) return false;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tool_window_open', { tool: id, pinned: layer.get().pinned.includes(id) });
    return true;
  } catch {
    return false;
  }
}

/** Opens a tool: its own window is brought forward if it has one, otherwise it floats over the page. */
export function openTool(id: ToolId): void {
  if (canPopOut()) void focusPopped(id).then((found) => !found && dock(id));
  else dock(id);
}

function dock(id: ToolId): void {
  if (!root) {
    const host = document.createElement('div');
    host.id = 'tool-windows';
    // One stacking context for the windows, so their order among themselves never lifts one above a dialog.
    host.className = styles.layer ?? '';
    document.body.append(host);
    root = createRoot(host);
    root.render(<Windows />);
  }
  if (!layer.get().open.includes(id)) layer.set((current) => ({ ...current, open: [...current.open, id] }));
  raise(id);
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>(`[data-tool="${id}"] [data-move]`)
      ?.focus({ focusVisible: false } as FocusOptions),
  );
}

export function closeTool(id: ToolId): void {
  layer.set((current) => ({
    ...current,
    open: current.open.filter((one) => one !== id),
    pinned: current.pinned.filter((one) => one !== id),
    used: current.used.filter((one) => one !== id),
  }));
}

/**
 * Puts every tool window back at its first place: the floating ones here, and the ones the app opened in windows of
 * their own, which forget their saved size, place, and monitor.
 */
export async function resetToolWindows(): Promise<void> {
  for (const tool of TOOLS) {
    forgetStored(`place.${tool.id}`);
    forgetStored(`width.${tool.id}`);
  }
  layer.set((current) => ({ ...current, epoch: current.epoch + 1, widths: {} }));
  if (!canPopOut()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tool_windows_reset');
  } catch {
    // The windows the app opened keep their places.
  }
}

/** The tools open now, for tests. */
export const openTools = (): readonly ToolId[] => layer.get().open;
