// @vitest-environment jsdom
// The title bar says "Saving" while a page batch is on its way: a stroke the page already draws isn't in the
// core until the core answers, and "Saved" over it would promise what a crash in between takes away.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pageSending, saveHealthStore } from '../../../services/pages/saveHealth';
import type { EditBatch, TxnAck } from '../../../services/pages/types';
import { resetStores } from '../../../state/store';
import { blockId, syncPage, syncRig } from './testSync';

const A = blockId(1);

beforeEach(() => resetStores());

describe('the send queue and the save status', () => {
  it('counts a batch as sending from the call until the core answers', async () => {
    const rig = await syncRig(syncPage(['One']));
    const real = rig.page.send.bind(rig.page);
    let release: (() => void) | undefined;
    rig.page.send = (batch: EditBatch): Promise<TxnAck> =>
      new Promise<void>((resolve) => (release = resolve)).then(() => real(batch));
    const sent = rig.queue.send({ edits: [{ edit: 'moveBlock', block: A, frame: { x: 10, y: 20 } }] });
    expect(pageSending(saveHealthStore.get())).toBe(true);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(pageSending(saveHealthStore.get())).toBe(true);
    release!();
    await sent;
    expect(pageSending(saveHealthStore.get())).toBe(false);
  });

  it('stops counting a batch the core refused', async () => {
    const rig = await syncRig(syncPage(['One']));
    rig.page.send = () => Promise.reject(new Error('refused'));
    await expect(rig.queue.send({ edits: [{ edit: 'moveBlock', block: A, frame: { x: 1, y: 2 } }] })).rejects.toThrow();
    expect(pageSending(saveHealthStore.get())).toBe(false);
  });
});
