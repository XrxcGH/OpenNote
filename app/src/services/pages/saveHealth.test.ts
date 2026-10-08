// The pages whose last save failed, from the core's save events, and what the title bar makes of them.
import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores } from '../../state/store';
import {
  anySaveFailing,
  combinedStatus,
  pageSaveFailed,
  pageSaved,
  saveHealthStore,
  watchSaveHealth,
} from './saveHealth';

function fakeClient() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    onEvent: (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => void handlers.delete(event);
    },
    emit: (event: string, payload: unknown) => handlers.get(event)?.(payload),
    listening: () => [...handlers.keys()],
  };
}

beforeEach(() => resetStores());

describe('save health', () => {
  it('keeps a page failing from its first failed save until the core saves it', () => {
    expect(anySaveFailing(saveHealthStore.get())).toBe(false);
    pageSaveFailed('p1');
    pageSaveFailed('p1');
    pageSaveFailed('p2');
    expect([...saveHealthStore.get().failing]).toEqual(['p1', 'p2']);
    pageSaved('p1');
    expect([...saveHealthStore.get().failing]).toEqual(['p2']);
    pageSaved('p2');
    expect(anySaveFailing(saveHealthStore.get())).toBe(false);
  });

  it('hears core:save-failed and core:saved, and nothing without a page', () => {
    const client = fakeClient();
    const stop = watchSaveHealth(client);
    expect(client.listening()).toEqual(['core:save-failed', 'core:saved']);
    client.emit('core:save-failed', { page: 'p1', kind: 'io', message: 'blocks differs after reading back' });
    client.emit('core:save-failed', { kind: 'io' });
    client.emit('core:save-failed', null);
    expect([...saveHealthStore.get().failing]).toEqual(['p1']);
    client.emit('core:saved', { page: 'p1', revision: 'r2' });
    expect(anySaveFailing(saveHealthStore.get())).toBe(false);
    stop();
    expect(client.listening()).toEqual([]);
  });

  it('turns "Saved" into "Couldn\'t save" while a page fails, and leaves the rest to the notes bridge', () => {
    expect(combinedStatus('saved', true)).toBe('error');
    expect(combinedStatus('saved', false)).toBe('saved');
    expect(combinedStatus('saving', true)).toBe('saving');
    expect(combinedStatus('offline', true)).toBe('offline');
    expect(combinedStatus('error', false)).toBe('error');
  });
});
