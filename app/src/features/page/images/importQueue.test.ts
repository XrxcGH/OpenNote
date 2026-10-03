import { describe, expect, it } from 'vitest';
import type { ImageSource, ImportedAsset } from '../../../services/pages/types';
import { createImportQueue, MAX_BYTES_IN_FLIGHT } from './importQueue';

const MB = 1024 * 1024;

function fakeImports() {
  const running: { source: ImageSource; done: boolean; finish(): void }[] = [];
  let peakBytes = 0;
  let peakActive = 0;
  const queue = createImportQueue({
    run: (source) =>
      new Promise<ImportedAsset>((resolve) => {
        const job = {
          source,
          done: false,
          finish() {
            job.done = true;
            resolve({ id: String(running.length), asset: {} as ImportedAsset['asset'] });
          },
        };
        running.push(job);
      }),
    onChange(state) {
      peakBytes = Math.max(peakBytes, state.bytes);
      peakActive = Math.max(peakActive, state.active);
    },
  });
  return { queue, running, peaks: () => ({ bytes: peakBytes, active: peakActive }) };
}

const photo = (mb: number): ImageSource => ({
  kind: 'bytes',
  bytes: new ArrayBuffer(mb * MB),
  name: 'photo.jpg',
  mime: 'image/jpeg',
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the import queue', () => {
  it('never holds more than 64 MB of source bytes or 4 imports', async () => {
    const { queue, running, peaks } = fakeImports();
    const done = Array.from({ length: 30 }, () => queue.add(photo(12)));
    await settle();
    while (running.some((job) => !job.done)) {
      expect(queue.state().bytes).toBeLessThanOrEqual(MAX_BYTES_IN_FLIGHT);
      running.find((job) => !job.done)?.finish();
      await settle();
    }
    await Promise.all(done);
    expect(peaks().bytes).toBeLessThanOrEqual(MAX_BYTES_IN_FLIGHT);
    expect(peaks().active).toBeLessThanOrEqual(4);
    expect(running).toHaveLength(30);
    expect(queue.state()).toEqual({ pending: 0, active: 0, bytes: 0 });
  });

  it('runs four imports by address at once', async () => {
    const { queue, running } = fakeImports();
    for (let i = 0; i < 6; i++) void queue.add({ kind: 'url', url: `https://example.com/${i}.png` });
    await settle();
    expect(running).toHaveLength(4);
    running[0].finish();
    await settle();
    expect(running).toHaveLength(5);
  });

  it('runs one import larger than the budget on its own', async () => {
    const { queue, running } = fakeImports();
    void queue.add(photo(70));
    void queue.add(photo(1));
    await settle();
    expect(running).toHaveLength(1);
    running[0].finish();
    await settle();
    expect(running).toHaveLength(2);
  });

  it('reads a file only when its turn comes', async () => {
    const { queue, running } = fakeImports();
    const files = Array.from({ length: 6 }, () => new Blob([new Uint8Array(20 * MB)], { type: 'image/png' }));
    files.forEach((file) => void queue.add({ kind: 'file', file, name: 'shot.png' }));
    await settle();
    expect(running).toHaveLength(3);
    expect(queue.state().bytes).toBeLessThanOrEqual(MAX_BYTES_IN_FLIGHT);
    expect(running[0].source).toMatchObject({ kind: 'bytes', name: 'shot.png', mime: 'image/png' });
  });

  it('drops a waiting import whose signal aborted', async () => {
    const { queue, running } = fakeImports();
    for (let i = 0; i < 4; i++) void queue.add(photo(1));
    await settle();
    const controller = new AbortController();
    const cancelled = queue.add(photo(1), controller.signal);
    controller.abort();
    running[0].finish();
    await expect(cancelled).rejects.toThrow(/cancelled/);
    expect(running).toHaveLength(4);
  });
});
