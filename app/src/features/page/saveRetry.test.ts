// Retry in the save notice saves the shown page and then what was typed while it couldn't save (N1-N03-4). The core
// takes no edits while the page's file is read-only, so that typing waits in the editors until the save goes through.
import { describe, expect, it, vi } from 'vitest';
import { saveRecovery } from '../../services/pages/saveHealth';
import { shownMounted } from './pagesApi';

describe('retrying a failed save', () => {
  it('saves, sends the edits that waited, and saves them too', async () => {
    const steps: string[] = [];
    const saveNow = vi.fn(async () => void steps.push('save'));
    const flushAll = vi.fn(async () => void steps.push('flush'));
    shownMounted.set({ page: { id: 'p1', saveNow }, sync: { flushAll } } as never);
    expect(await saveRecovery()?.retry('p1')).toBe(true);
    expect(steps).toEqual(['save', 'flush', 'save']);
  });

  it('answers false for a page that is not shown here', async () => {
    shownMounted.set(null);
    expect(await saveRecovery()?.retry('p1')).toBe(false);
  });
});
