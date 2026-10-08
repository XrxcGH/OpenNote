// The tool windows (Phase 10), opened from the command palette. In the app they float over the page; "Open in its
// own window" moves one to a window of its own, where the app can make one. Opening a tool that is already open
// brings it forward. The layer mounts on first use, so nothing here costs anything until a tool is opened.
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { createStore, useStore } from '../../../state/store';
import { CalculatorTool } from './CalculatorTool';
import { TimersTool } from './TimersTool';
import { ExtraToolBody } from './extraTools';
import { ToolWindow } from './ToolWindow';
import { UpcomingTool } from './UpcomingTool';
import { forgetStored } from './storage';
import { TOOLS } from './tools';
import type { ToolId } from './tools';

interface Layer {
  open: readonly ToolId[];
  /** The tools kept above the others. */
  pinned: readonly ToolId[];
  /** Counts the times the windows were reset, so each draws again at its first place. */
  epoch: number;
}

const layer = createStore<Layer>({ open: [], pinned: [], epoch: 0 }, 'tool windows');
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

function Windows() {
  const state = useStore(layer, (current) => current);
  return (
    <>
      {state.open.map((id, index) => {
        const tool = TOOLS.find((one) => one.id === id)!;
        const pinned = state.pinned.includes(id);
        return (
          <ToolWindow
            key={`${id}-${state.epoch}`}
            tool={tool}
            index={index}
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

export function openTool(id: ToolId): void {
  if (!root) {
    const host = document.createElement('div');
    host.id = 'tool-windows';
    document.body.append(host);
    root = createRoot(host);
    root.render(<Windows />);
  }
  if (!layer.get().open.includes(id)) layer.set((current) => ({ ...current, open: [...current.open, id] }));
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tool="${id}"] [data-move]`)?.focus());
}

export function closeTool(id: ToolId): void {
  layer.set((current) => ({
    ...current,
    open: current.open.filter((one) => one !== id),
    pinned: current.pinned.filter((one) => one !== id),
  }));
}

/**
 * Puts every tool window back at its first place: the floating ones here, and the ones the app opened in windows of
 * their own, which forget their saved size, place, and monitor.
 */
export async function resetToolWindows(): Promise<void> {
  for (const tool of TOOLS) forgetStored(`place.${tool.id}`);
  layer.set((current) => ({ ...current, epoch: current.epoch + 1 }));
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
