// @vitest-environment node
// The hook that saves the notes before the window closes: what it says when saving can't work, and the way out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../app/flags';
import { beforeExit } from '../../registries';
import { createNotesService } from '../../services/notes';
import type { NotesSnapshotClient, Platform } from '../../platform/types';
import { createTestPlatform } from '../../test/platform';
import { CLOSE_ANYWAY_MS } from './register';

const hook = () => {
  const found = beforeExit.list().find((item) => item.id === 'notes.flush');
  if (!found) throw new Error('The notes.flush hook is not registered.');
  return found;
};

/** A snapshot that rejects with `failure` until `fix()` is called. */
function brokenSnapshot(failure: unknown) {
  const saves: string[] = [];
  let broken = true;
  const client: NotesSnapshotClient = {
    load: () => Promise.resolve(null),
    save(json) {
      if (broken) return Promise.reject(failure);
      saves.push(json);
      return Promise.resolve();
    },
  };
  return { client, saves, fix: () => void (broken = false) };
}

/** The service on a platform, with one change made that has to be saved. */
async function start(platform: Platform) {
  initFlags(platform.boot.channel);
  const notes = await createNotesService(platform);
  await notes.create({ kind: 'notebook', placement: { parentId: null, beforeId: null }, title: 'Thesis' });
  return notes;
}

const diskFull = { code: 'io', message: 'The disk is full.' };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  initFlags('dev');
});

describe('the notes.flush exit hook', () => {
  it('lets the window close once the notes are saved', async () => {
    const snapshot = brokenSnapshot(diskFull);
    await start({ ...createTestPlatform(), notesSnapshot: snapshot.client });
    snapshot.fix();
    await expect(hook().run('close')).resolves.toEqual({ ok: true });
    expect(snapshot.saves).toHaveLength(1);
  });

  it('refuses with the reason the save gave, and offers to close anyway', async () => {
    const snapshot = brokenSnapshot(diskFull);
    await start({ ...createTestPlatform(), notesSnapshot: snapshot.client });
    const answer = await hook().run('close');
    expect(answer).toMatchObject({ ok: false, reason: 'tree.exit.unsaved' });
    if (answer.ok) return;
    expect(answer.message).toContain('The disk is full.');
    expect(answer.closeAnyway).toBeTypeOf('function');
  });

  it('lets one close through after "Close anyway", and no more', async () => {
    const snapshot = brokenSnapshot(diskFull);
    await start({ ...createTestPlatform(), notesSnapshot: snapshot.client });
    const refused = await hook().run('close');
    if (refused.ok) throw new Error('Expected a refusal.');
    refused.closeAnyway?.();
    await expect(hook().run('close')).resolves.toEqual({ ok: true });
    await expect(hook().run('close')).resolves.toMatchObject({ ok: false });
  });

  it('forgets "Close anyway" after a few seconds', async () => {
    const snapshot = brokenSnapshot(diskFull);
    await start({ ...createTestPlatform(), notesSnapshot: snapshot.client });
    const refused = await hook().run('close');
    if (refused.ok) throw new Error('Expected a refusal.');
    refused.closeAnyway?.();
    await vi.advanceTimersByTimeAsync(CLOSE_ANYWAY_MS);
    await expect(hook().run('close')).resolves.toMatchObject({ ok: false });
  });

  it('says plainly that a build without the snapshot keeps nothing', async () => {
    const web = createTestPlatform({ boot: { channel: 'stable' } });
    await start({ ...web, kind: 'tauri', notesSnapshot: null });
    const answer = await hook().run('close');
    expect(answer).toMatchObject({ ok: false, closeAnyway: expect.any(Function) as unknown });
    if (!answer.ok) expect(answer.message).toMatch(/doesn't keep your notes/);
  });
});
