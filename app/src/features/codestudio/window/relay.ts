// The studio in a window of its own (the tool windows' pop-out, PoppedTool). The page and its project block stay in
// the main window, so the popped studio edits the block through a BroadcastChannel: it asks for the block's data,
// sends each change as a patch, and hears newer data. The main window answers from its shown page (blockSource);
// the page registers that answer at start-up (features/page/registrations/codeStudio.ts), so it works while the
// docked studio is closed. Both windows are the same app, so the channel never leaves this device.

import type { ProjectSource } from './source';

export const RELAY_CHANNEL = 'opennote.codestudio';
/** The block the studio showed last, for a window that opens later. Device state, never synced. */
export const CURRENT_KEY = 'opennote.codestudio.current';
/** How long the popped studio waits for the main window. */
export const RELAY_WAIT_MS = 2000;

export type RelayMessage =
  | { kind: 'open'; block: string }
  | { kind: 'data'; block: string; data: Record<string, unknown>; readOnly: boolean }
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
    case 'data':
      return isRecord(value.data) ? { kind: 'data', block, data: value.data, readOnly: value.readOnly === true } : null;
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
 * The main window's side: answers each popped studio from the shown page. `open` sends the data and then every
 * newer version; `patch` goes to the page as the docked studio's would.
 */
export function serveRelay(channel: Channel, find: (block: string) => ProjectSource | null): () => void {
  const watched = new Map<string, ProjectSource>();
  const send = (block: string, source: ProjectSource) =>
    channel.postMessage({ kind: 'data', block, data: source.data(), readOnly: source.readOnly() });
  const listener = (event: MessageEvent) => {
    const message = readRelay(event.data);
    if (!message) return;
    if (message.kind === 'open') {
      let source = watched.get(message.block);
      if (!source) {
        source = find(message.block) ?? undefined;
        if (!source) return channel.postMessage({ kind: 'missing', block: message.block });
        const held = source;
        held.subscribe(() => send(message.block, held));
        watched.set(message.block, held);
      }
      send(message.block, source);
    } else if (message.kind === 'patch') {
      const source = watched.get(message.block) ?? find(message.block);
      if (!source || source.readOnly()) return;
      source.patch(message.data, message.fallback);
    } else if (message.kind === 'close') {
      watched.get(message.block)?.dispose();
      watched.delete(message.block);
    }
  };
  channel.addEventListener('message', listener);
  return () => {
    channel.removeEventListener('message', listener);
    for (const source of watched.values()) source.dispose();
    watched.clear();
  };
}

/**
 * The popped window's side: the block through the main window. Resolves null when the main window does not
 * answer in time or has no such block.
 */
export function remoteSource(block: string, channel: Channel, waitMs = RELAY_WAIT_MS): Promise<ProjectSource | null> {
  return new Promise((resolve) => {
    let data: Record<string, unknown> | null = null;
    let readOnly = false;
    const listeners = new Set<() => void>();
    const source: ProjectSource = {
      key: block,
      kind: 'remote',
      data: () => data ?? {},
      readOnly: () => readOnly,
      patch(patch, fallback) {
        channel.postMessage({ kind: 'patch', block, data: patch, fallback });
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose() {
        channel.removeEventListener('message', listener);
        channel.postMessage({ kind: 'close', block });
      },
    };
    const timer = setTimeout(() => {
      channel.removeEventListener('message', listener);
      resolve(null);
    }, waitMs);
    function listener(event: MessageEvent) {
      const message = readRelay(event.data);
      if (!message || message.block !== block) return;
      if (message.kind === 'missing') {
        clearTimeout(timer);
        channel.removeEventListener('message', listener);
        resolve(null);
      } else if (message.kind === 'data') {
        const first = data === null;
        data = message.data;
        readOnly = message.readOnly;
        if (first) {
          clearTimeout(timer);
          resolve(source);
        } else for (const one of listeners) one();
      }
    }
    channel.addEventListener('message', listener);
    channel.postMessage({ kind: 'open', block });
  });
}

/** True in the window the app opens for the studio alone. */
export const inPoppedWindow = (): boolean =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('tool') === 'code';
