// @vitest-environment node
// The snapshot saver on its own: when it tries again after a failed save, and what it reports.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotesSnapshotClient } from '../../platform/types';
import { isNotesError } from './errors';
import { createSnapshotSaver, SNAPSHOT_DEBOUNCE_MS, SNAPSHOT_RETRY_MAX_MS, SNAPSHOT_RETRY_MS } from './snapshot';
import type { SnapshotSaver } from './snapshot';
import type { SaveStatus } from './types';

/** A client whose saves fail with Rust's kind of error, a plain object, for the first `failures` calls. */
function client(failures: number) {
  const attempts: string[] = [];
  const saved: string[] = [];
  const target: NotesSnapshotClient = {
    load: () => Promise.resolve(null),
    save(json) {
      attempts.push(json);
      if (attempts.length <= failures) return Promise.reject({ code: 'io', message: 'The disk is full.' });
      saved.push(json);
      return Promise.resolve();
    },
  };
  return { target, attempts, saved };
}

function saverFor(target: NotesSnapshotClient): { saver: SnapshotSaver; statuses: SaveStatus[] } {
  const statuses: SaveStatus[] = [];
  const saver = createSnapshotSaver(target, () => '{}', { onStatus: (status) => statuses.push(status) });
  return { saver, statuses };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a failed snapshot save', () => {
  it('is tried again on a timer, with a wait that doubles, until a save works', async () => {
    const { target, attempts } = client(3);
    const { saver, statuses } = saverFor(target);
    saver.changed();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS);
    expect(attempts).toHaveLength(1);
    expect(saver.status()).toBe('error');
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MS - 1);
    expect(attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MS * 2);
    expect(attempts).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MS * 4);
    expect(attempts).toHaveLength(4);
    expect(saver.hasUnsaved()).toBe(false);
    expect(saver.status()).toBe('saved');
    expect(statuses.at(-1)).toBe('saved');
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MAX_MS * 2);
    expect(attempts).toHaveLength(4);
  });

  it('never waits longer than the maximum between tries', async () => {
    const { target, attempts } = client(Infinity);
    const { saver } = saverFor(target);
    saver.changed();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS);
    // 5 s, 10 s, 20 s, 40 s, then 60 s each.
    await vi.advanceTimersByTimeAsync((5 + 10 + 20 + 40) * 1000);
    expect(attempts).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MAX_MS);
    expect(attempts).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MAX_MS);
    expect(attempts).toHaveLength(7);
    expect(saver.hasUnsaved()).toBe(true);
  });

  it("reports why, from Rust's error, which is a plain object", async () => {
    const { target } = client(1);
    const { saver } = saverFor(target);
    saver.changed();
    const failure = await saver.flush().catch((error: unknown) => error);
    expect(isNotesError(failure, 'io')).toBe(true);
    expect(isNotesError(failure) && failure.detail).toBe('The disk is full.');
  });
});
