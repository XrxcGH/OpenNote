// Manage recordings: what is left on the drive is shown beside what the recordings take.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredRecording } from '../../../core/audio';
import { renderUi } from '../../../test';
import { setMoreClient, withoutHost } from './moreClient';
import { StorageDialog } from './StorageDialog';

const stored = {
  notebook: 'Lectures',
  section: 'Biology',
  page: 'p1',
  pageTitle: 'Mitosis',
  assetsDir: 'C:/notes/assets',
  entry: { id: 'r1', started: '2026-05-01T10:00:00Z', tracks: [] },
  durationNs: 60e9,
  bytes: 2_000_000,
  freesSmaller: 0,
  freesSmallest: 0,
} as unknown as StoredRecording;

afterEach(() => {
  cleanup();
  setMoreClient(null);
});

describe('Manage recordings', () => {
  it('leaves the line out, and still lists the recordings, when the free space can not be read', async () => {
    setMoreClient({
      ...withoutHost,
      storageScan: () => Promise.resolve([stored]),
      freeSpace: () => Promise.reject(new Error('no')),
    });
    renderUi(<StorageDialog onClose={() => undefined} />);
    expect(await screen.findByText(/Together they take/)).toBeTruthy();
    expect(screen.queryByText(/is free on the drive/)).toBeNull();
  });

  it('says how much is free on the drive that holds the notebooks', async () => {
    setMoreClient({
      ...withoutHost,
      storageScan: () => Promise.resolve([stored]),
      freeSpace: () => Promise.resolve(12e9),
    });
    renderUi(<StorageDialog onClose={() => undefined} />);
    expect(await screen.findByText(/Together they take/)).toBeTruthy();
    expect(await screen.findByText(/12(\.0)? GB is free on the drive that holds your notebooks/)).toBeTruthy();
  });
});
