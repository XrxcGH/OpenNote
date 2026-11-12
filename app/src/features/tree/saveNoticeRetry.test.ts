// Retry in the save notice names the reason the retry itself failed for (N1-N03-4), not the first failure's reason.
import { afterEach, describe, expect, it } from 'vitest';
import { pageSaveFailed, saveHealthStore } from '../../services/pages/saveHealth';
import type { SaveRecovery } from '../../services/pages/saveHealth';
import { retryPage, saveFailureReason } from './SaveNotice';

afterEach(() => saveHealthStore.set((state) => ({ ...state, failing: new Set(), failures: new Map() })));

const failingRetry = (kind: string): SaveRecovery =>
  ({
    holds: () => true,
    text: async () => '',
    retry: async (page: string) => {
      pageSaveFailed(page, { kind, retrying: false });
      throw new Error(kind);
    },
  }) as unknown as SaveRecovery;

describe('retrying from the save notice', () => {
  it("names the retry's own reason", async () => {
    const text = await retryPage(failingRetry('diskFull'), 'p1', { kind: 'readOnlyFile', retrying: false });
    expect(text).toContain(saveFailureReason('diskFull'));
    expect(text).not.toContain(saveFailureReason('readOnlyFile'));
  });

  it('says nothing when the retry saved', async () => {
    const saved = { retry: async () => true } as unknown as SaveRecovery;
    expect(await retryPage(saved, 'p1', { kind: 'readOnlyFile', retrying: false })).toBeNull();
  });
});
