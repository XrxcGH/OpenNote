// @vitest-environment jsdom
// The idle loader (owner: WP6). A load that fails, or that runs after the page is gone, is not an unhandled error.
import { describe, expect, it } from 'vitest';
import { later } from './later';

describe('later', () => {
  it('runs the load once the page is idle', async () => {
    let calls = 0;
    later(async () => void (calls += 1));
    await expect.poll(() => calls).toBe(1);
  });

  it('leaves a failed load to whatever needs the module first', async () => {
    let calls = 0;
    // A spy would handle the rejection itself, so this counts by hand: an unhandled rejection fails the run.
    later(() => {
      calls += 1;
      return Promise.reject(new Error('The environment was torn down.'));
    });
    await expect.poll(() => calls).toBe(1);
    await new Promise((done) => setTimeout(done, 20));
  });
});
