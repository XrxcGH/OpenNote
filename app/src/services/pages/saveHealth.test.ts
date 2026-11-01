// The pages whose last save failed, from the core's save events, and what the title bar makes of them.
import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores } from '../../state/store';
import {
  anySaveFailing,
  combinedStatus,
  coreBusy,
  coreStalled,
  pageClosed,
  pageOpened,
  pageSaveFailed,
  pageSaved,
  pageSending,
  pageUnwritten,
  pageWaiting,
  waitingDetail,
  saveHealthStore,
  sendingPage,
  setCoreStalled,
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

  it('forgets a page that closed, since no save will be reported for it', () => {
    pageSaveFailed('p1');
    pageSaveFailed('p2');
    pageClosed('p1');
    expect([...saveHealthStore.get().failing]).toEqual(['p2']);
    pageClosed('p3');
    expect([...saveHealthStore.get().failing]).toEqual(['p2']);
  });

  it('says the core is stalled from core:stalled until core:responsive', () => {
    const client = fakeClient();
    const stop = watchSaveHealth(client);
    expect(coreStalled(saveHealthStore.get())).toBe(false);
    client.emit('core:stalled', { what: 'page_apply', seconds: 10 });
    expect(coreStalled(saveHealthStore.get())).toBe(true);
    client.emit('core:stalled', { what: 'page_apply', seconds: 20 });
    expect(coreStalled(saveHealthStore.get())).toBe(true);
    client.emit('core:responsive', {});
    expect(coreStalled(saveHealthStore.get())).toBe(false);
    setCoreStalled(true);
    expect(combinedStatus('saving', false, coreStalled(saveHealthStore.get()))).toBe('stalled');
    client.emit('core:responsive', {});
    coreBusy();
    expect(coreStalled(saveHealthStore.get())).toBe(true);
    stop();
  });

  it('hears core:save-failed and core:saved, and nothing without a page', () => {
    const client = fakeClient();
    const stop = watchSaveHealth(client);
    expect(client.listening()).toEqual(['core:save-failed', 'core:saved', 'core:stalled', 'core:responsive']);
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
    expect(combinedStatus('saved', false, true)).toBe('stalled');
    expect(combinedStatus('saving', true, true)).toBe('stalled');
  });

  it('says "Saving" while a page batch is on its way to the core, until the last one arrives', () => {
    const first = sendingPage();
    const second = sendingPage();
    expect(combinedStatus('saved', false, false, pageSending(saveHealthStore.get()))).toBe('saving');
    first();
    first();
    expect(pageSending(saveHealthStore.get())).toBe(true);
    second();
    expect(combinedStatus('saved', false, false, pageSending(saveHealthStore.get()))).toBe('saved');
    expect(combinedStatus('saved', true, false, true)).toBe('error');
    expect(combinedStatus('saved', false, true, true)).toBe('stalled');
  });
});

describe('save health of unwritten edits', () => {
  it('says "Saving" over an edit answered as not written until a save holds it', () => {
    const client = fakeClient();
    const stop = watchSaveHealth(client);
    pageUnwritten('p1', 7);
    pageUnwritten('p1', 5);
    expect(combinedStatus('saved', false, false, pageWaiting(saveHealthStore.get()))).toBe('saving');
    // A save that began before the edit doesn't hold it.
    client.emit('core:saved', { page: 'p1', through: 6 });
    expect(pageWaiting(saveHealthStore.get())).toBe(true);
    client.emit('core:saved', { page: 'p2', through: 9 });
    expect(pageWaiting(saveHealthStore.get())).toBe(true);
    client.emit('core:saved', { page: 'p1', through: 7 });
    expect(combinedStatus('saved', false, false, pageWaiting(saveHealthStore.get()))).toBe('saved');
    stop();
  });

  it('keeps a closed page waiting until a save holds its unwritten edit, since the close may not save it', () => {
    const client = fakeClient();
    const stop = watchSaveHealth(client);
    pageUnwritten('p2', 3);
    pageClosed('p2');
    expect(pageWaiting(saveHealthStore.get())).toBe(true);
    expect(waitingDetail(saveHealthStore.get())).toBe('unwritten p2@3');
    client.emit('core:saved', { page: 'p2', through: 3 });
    expect(pageWaiting(saveHealthStore.get())).toBe(false);
    stop();
  });

  it('takes a save that arrived before the edit’s answer as holding it, until the page opens again', () => {
    const client = fakeClient();
    const stop = watchSaveHealth(client);
    client.emit('core:saved', { page: 'p1', through: 4 });
    pageUnwritten('p1', 4);
    expect(pageWaiting(saveHealthStore.get())).toBe(false);
    pageUnwritten('p1', 5);
    expect(waitingDetail(saveHealthStore.get())).toBe('unwritten p1@5');
    client.emit('core:saved', { page: 'p1', through: 5 });
    // A page opened again may number its edits afresh, so the old save holds none of them.
    pageOpened('p1');
    pageUnwritten('p1', 2);
    expect(pageWaiting(saveHealthStore.get())).toBe(true);
    stop();
  });
});
