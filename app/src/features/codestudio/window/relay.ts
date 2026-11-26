// The studio in a window of its own (the tool windows' pop-out, PoppedTool). The page and its project block stay in
// the main window, so the popped studio edits the block through a BroadcastChannel: it asks for the block's data,
// sends each change as a patch, and hears newer data. The main window answers from its shown page (blockSource);
// the page registers that answer at start-up (features/page/registrations/codeStudio.ts), so it works while the
// docked studio is closed. Both windows are the same app, so the channel never leaves this device.

import { windowKind } from '../../../app/windowKind';
import { t } from '../../../strings/t';
import type { ProjectSource } from './source';

export const RELAY_CHANNEL = 'opennote.codestudio';
/** The block the studio showed last, for a window that opens later. Device state, never synced. */
export const CURRENT_KEY = 'opennote.codestudio.current';
/**
 * How long the popped studio waits for the main window: for the block's data at start, and for the answer to a
 * patch. A `missing` answer does not cut it short. Every window serves the relay, so a page window without the block
 * may answer first, while the main window still loads the studio's chunk (gap V2-5).
 */
export const RELAY_WAIT_MS = 2000;

/** Why the main window's block reads as read-only: its page is not shown, or the block left the page. */
export type RelayReason = 'pageClosed' | 'projectRemoved';

export type RelayMessage =
  | { kind: 'open'; block: string }
  | { kind: 'data'; block: string; data: Record<string, unknown>; readOnly: boolean; reason?: RelayReason }
  | { kind: 'missing'; block: string }
  | { kind: 'patch'; block: string; data: Record<string, unknown>; fallback: string }
  | { kind: 'close'; block: string };

export interface Channel {
  postMessage(message: RelayMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A message from the channel, checked, or null. */
export function readRelay(value: unknown): RelayMessage | null {
  if (!isRecord(value) || typeof value.block !== 'string') return null;
  const block = value.block;
  switch (value.kind) {
    case 'open':
    case 'missing':
    case 'close':
      return { kind: value.kind, block };
    case 'data': {
      if (!isRecord(value.data)) return null;
      const reason = value.reason === 'pageClosed' || value.reason === 'projectRemoved' ? value.reason : undefined;
      return { kind: 'data', block, data: value.data, readOnly: value.readOnly === true, ...(reason && { reason }) };
    }
    case 'patch':
      return isRecord(value.data) && typeof value.fallback === 'string'
        ? { kind: 'patch', block, data: value.data, fallback: value.fallback }
        : null;
    default:
      return null;
  }
}

export function rememberCurrent(block: string | null): void {
  try {
    if (block) localStorage.setItem(CURRENT_KEY, block);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    // Not remembered.
  }
}

export function currentBlock(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

/**
 * The main window's side: it answers each popped studio from the shown page.
 * - `open` sends the data, then every newer version.
 * - `patch` goes to the page as the docked studio's would. The answer is the data, so the popped studio knows what
 *   the page has.
 * - A block whose page closed reads as read-only. `changes` (the shown page changed) finds it again.
 */
export function serveRelay(
  channel: Channel,
  find: (block: string) => ProjectSource | null,
  changes?: (listener: () => void) => () => void,
): () => void {
  const watched = new Map<string, ProjectSource>();
  const send = (block: string, source: ProjectSource) => {
    const reason: RelayReason | undefined = !source.live()
      ? 'pageClosed'
      : source.removed?.()
        ? 'projectRemoved'
        : undefined;
    const readOnly = source.readOnly();
    channel.postMessage({ kind: 'data', block, data: source.data(), readOnly, ...(reason && { reason }) });
  };
  /** The block's source that can still reach its page, found again when the one held let go. */
  const live = (block: string): ProjectSource | null => {
    const held = watched.get(block);
    if (held?.live()) return held;
    const found = find(block);
    if (!found) return held ?? null;
    held?.dispose();
    found.subscribe(() => send(block, found));
    watched.set(block, found);
    return found;
  };
  const listener = (event: MessageEvent) => {
    const message = readRelay(event.data);
    if (!message) return;
    if (message.kind === 'open') {
      const source = live(message.block);
      if (!source) return channel.postMessage({ kind: 'missing', block: message.block });
      send(message.block, source);
    } else if (message.kind === 'patch') {
      const source = live(message.block);
      if (!source) return;
      if (source.live() && !source.readOnly()) source.patch(message.data, message.fallback);
      send(message.block, source);
    } else if (message.kind === 'close') {
      watched.get(message.block)?.dispose();
      watched.delete(message.block);
    }
  };
  channel.addEventListener('message', listener);
  const stopChanges = changes?.(() => {
    for (const [block, held] of [...watched]) {
      if (held.live()) continue;
      const source = live(block);
      if (source && source !== held) send(block, source);
    }
  });
  return () => {
    channel.removeEventListener('message', listener);
    stopChanges?.();
    for (const source of watched.values()) source.dispose();
    watched.clear();
  };
}

/**
 * The popped window's side: the block through the main window. Resolves null when no window has the block's data
 * in time. The main window answers each patch with its data and says why the block is read-only, so the popped
 * studio shows the same notice as the docked one. A patch with no answer in time means the main window is gone.
 */
export function remoteSource(block: string, channel: Channel, waitMs = RELAY_WAIT_MS): Promise<ProjectSource | null> {
  return new Promise((resolve) => {
    let data: Record<string, unknown> | null = null;
    let readOnly = false;
    let reason: RelayReason | 'noAnswer' | null = null;
    let answer: ReturnType<typeof setTimeout> | null = null;
    const listeners = new Set<() => void>();
    const notify = () => {
      for (const one of [...listeners]) one();
    };
    const source: ProjectSource = {
      key: block,
      kind: 'remote',
      data: () => data ?? {},
      readOnly: () => readOnly || reason !== null,
      patch(patch, fallback) {
        channel.postMessage({ kind: 'patch', block, data: patch, fallback });
        answer ??= setTimeout(() => {
          answer = null;
          reason = 'noAnswer';
          notify();
        }, waitMs);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      live: () => reason !== 'pageClosed' && reason !== 'noAnswer',
      removed: () => reason === 'projectRemoved',
      lostNotice: () => (reason === 'noAnswer' ? t('codeStudio.studio.noAnswer') : null),
      onLeave: () => () => {},
      dispose() {
        if (answer !== null) clearTimeout(answer);
        channel.removeEventListener('message', listener);
        channel.postMessage({ kind: 'close', block });
      },
    };
    const giveUp = () => {
      channel.removeEventListener('message', listener);
      resolve(null);
    };
    const timer = setTimeout(giveUp, waitMs);
    function listener(event: MessageEvent) {
      const message = readRelay(event.data);
      if (!message || message.block !== block) return;
      // A `missing` answer is from a window without the block; the main window may still answer, so it is no news.
      if (message.kind !== 'data') return;
      const first = data === null;
      data = message.data;
      readOnly = message.readOnly;
      reason = message.reason ?? null;
      if (answer !== null) clearTimeout(answer);
      answer = null;
      if (first) {
        clearTimeout(timer);
        resolve(source);
      } else notify();
    }
    channel.addEventListener('message', listener);
    channel.postMessage({ kind: 'open', block });
  });
}

/** The tool this window shows alone, as main.tsx reads it: `?tool=`, or `__OPENNOTE_TOOL__` from the desktop shell. */
export function poppedTool(): string | null {
  if (typeof window === 'undefined' || windowKind() !== 'tool') return null;
  return (
    new URLSearchParams(window.location.search).get('tool') ??
    (window as { __OPENNOTE_TOOL__?: string }).__OPENNOTE_TOOL__ ??
    null
  );
}

/** True in the window the app opens for the studio alone. */
export const inPoppedWindow = (): boolean => poppedTool() === 'code';
