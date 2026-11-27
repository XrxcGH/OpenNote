// @vitest-environment jsdom
// The roving tab stop of the table bars (roving.ts).
import { describe, expect, it } from 'vitest';
import { rove } from './roving';

describe('the roving tab stop', () => {
  it('leaves buttons that already have the right tab index alone (nightly perf-typing-gate, table)', async () => {
    // The cell format bar moves its tab stop on every render, and typing in a cell renders it on every key.
    const bar = document.createElement('div');
    bar.innerHTML = '<button data-tool>B</button><button data-tool>I</button><button data-tool>U</button>';
    rove(bar);
    const writes: MutationRecord[] = [];
    const watch = new MutationObserver((records) => writes.push(...records));
    watch.observe(bar, { attributes: true, subtree: true });
    rove(bar);
    await Promise.resolve();
    watch.disconnect();
    expect(writes).toEqual([]);
    expect([...bar.querySelectorAll('button')].map((button) => button.tabIndex)).toEqual([0, -1, -1]);
  });

  it('still moves the stop to the button asked for', () => {
    const bar = document.createElement('div');
    bar.innerHTML = '<button data-tool>B</button><button data-tool>I</button>';
    rove(bar);
    rove(bar, bar.querySelectorAll('button')[1]);
    expect([...bar.querySelectorAll('button')].map((button) => button.tabIndex)).toEqual([-1, 0]);
  });
});
