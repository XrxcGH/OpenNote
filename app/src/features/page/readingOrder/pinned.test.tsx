// The pinned reorder, as a property in a real browser: for random orders and a random focused wrapper, the focused
// wrapper is never moved, it keeps focus, and the children end in the new order.
import { afterEach, describe, expect, it } from 'vitest';
import { pinnedReorder } from './pinned';

let container: HTMLElement;

afterEach(() => container.remove());

/** A small, seeded generator, so a failure repeats. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('the pinned reorder', () => {
  it('never moves the focused wrapper and always reaches the new order', () => {
    const next = random(20261003);
    for (let run = 0; run < 200; run += 1) {
      container = document.body.appendChild(document.createElement('div'));
      const count = 2 + Math.floor(next() * 12);
      const wrappers = Array.from({ length: count }, (_, index) => {
        const wrapper = document.createElement('div');
        wrapper.tabIndex = -1;
        wrapper.textContent = String(index);
        return wrapper;
      });
      container.append(...shuffle(wrappers, next));
      const focused = wrappers[Math.floor(next() * count)]!;
      focused.focus();
      const removed: Node[] = [];
      const observer = new MutationObserver((records) => records.forEach((r) => removed.push(...r.removedNodes)));
      observer.observe(container, { childList: true });
      const target = shuffle(wrappers, next);
      pinnedReorder(container, target, focused);
      removed.push(...observer.takeRecords().flatMap((record) => [...record.removedNodes]));
      observer.disconnect();
      expect(removed).not.toContain(focused);
      expect(document.activeElement).toBe(focused);
      expect([...container.children]).toEqual(target);
      container.remove();
    }
    container = document.body.appendChild(document.createElement('div'));
  });

  it('moves only what is out of place', () => {
    container = document.body.appendChild(document.createElement('div'));
    const make = () => document.createElement('div');
    const [a, b, c, d] = [make(), make(), make(), make()];
    container.append(a, b, c, d);
    expect(pinnedReorder(container, [a, c, d, b], null)).toBe(1);
    expect([...container.children]).toEqual([a, c, d, b]);
  });
});
