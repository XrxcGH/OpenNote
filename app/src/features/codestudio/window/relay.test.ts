// The popped studio edits the main window's project block through the relay.
import { describe, expect, it, vi } from 'vitest';
import type { Channel, RelayMessage } from './relay';
import { readRelay, remoteSource, serveRelay } from './relay';
import type { ProjectSource } from './source';

/** Two ends of one channel, delivering on a later turn as BroadcastChannel does. */
function pair(): [Channel, Channel] {
  const make = (): Channel & { other?: Channel & { target: EventTarget }; target: EventTarget } => {
    const target = new EventTarget();
    const end = {
      target,
      postMessage(message: RelayMessage) {
        const other = end.other!;
        setTimeout(() => other.target.dispatchEvent(new MessageEvent('message', { data: message })), 0);
      },
      addEventListener: (type: 'message', listener: (event: MessageEvent) => void) =>
        target.addEventListener(type, listener as EventListener),
      removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) =>
        target.removeEventListener(type, listener as EventListener),
      close: () => {},
    } as Channel & { other?: Channel & { target: EventTarget }; target: EventTarget };
    return end;
  };
  const a = make();
  const b = make();
  a.other = b;
  b.other = a;
  return [a, b];
}

function memorySource(block: string, data: Record<string, unknown>) {
  const listeners = new Set<() => void>();
  const patches: Record<string, unknown>[] = [];
  const source: ProjectSource = {
    key: block,
    kind: 'block',
    data: () => data,
    readOnly: () => false,
    patch(patch) {
      patches.push(patch);
      data = { ...data, ...patch };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: vi.fn(),
  };
  return { source, patches, change: (next: Record<string, unknown>) => ((data = next), listeners.forEach((l) => l())) };
}

describe('the pop-out relay', () => {
  it('opens a block, sends patches to the page, and hears newer data', async () => {
    const [main, popped] = pair();
    const held = memorySource('b1', { name: 'One' });
    const stop = serveRelay(main, (block) => (block === 'b1' ? held.source : null));
    const remote = await remoteSource('b1', popped);
    expect(remote?.data()).toEqual({ name: 'One' });
    remote!.patch({ name: 'Two' }, 'fallback');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(held.patches).toEqual([{ name: 'Two' }]);
    const heard = vi.fn();
    remote!.subscribe(heard);
    held.change({ name: 'Three' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(heard).toHaveBeenCalled();
    expect(remote!.data()).toEqual({ name: 'Three' });
    remote!.dispose();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(held.source.dispose).toHaveBeenCalled();
    stop();
  });

  it('answers null for a block the main window does not have, or when no one answers', async () => {
    const [main, popped] = pair();
    serveRelay(main, () => null);
    expect(await remoteSource('nope', popped)).toBeNull();
    const [, alone] = pair();
    expect(await remoteSource('b1', alone, 20)).toBeNull();
  });

  it('drops malformed messages', () => {
    expect(readRelay({ kind: 'patch', block: 'b', data: [] })).toBeNull();
    expect(readRelay({ kind: 'data', block: 1, data: {} })).toBeNull();
    expect(readRelay({ kind: 'other', block: 'b' })).toBeNull();
    expect(readRelay({ kind: 'open', block: 'b' })).toEqual({ kind: 'open', block: 'b' });
  });
});
