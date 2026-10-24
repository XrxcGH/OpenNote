// T2-10: ink anchored to a word moves by the full distance its word moves when lines are added above it.
import { afterEach, describe, expect, it } from 'vitest';
import { followDelta, offsetFrom, quoteAt } from '../anchor';
import { placeNow } from './anchoring';

const holders: HTMLElement[] = [];
afterEach(() => holders.splice(0).forEach((h) => h.remove()));

function page(lines: string[]): HTMLElement {
  const root = document.body.appendChild(document.createElement('div'));
  root.style.cssText = 'position:absolute;left:0;top:0;font:16px/28px sans-serif';
  holders.push(root);
  for (const text of lines) root.appendChild(document.createElement('p')).textContent = text;
  root.querySelectorAll('p').forEach((p) => (p.style.margin = '0'));
  return root;
}

describe('anchored ink follows its word', () => {
  it('moves by the full distance when two lines are inserted above', () => {
    const root = page(['Alpha line one', 'Bravo line two', 'Charlie line three']);
    const bravo = root.children[1] as HTMLElement;
    const text = bravo.textContent!;
    const at = 6;
    const anchor = { at, quote: quoteAt(text, at) };
    const before = placeNow(bravo, anchor)!;
    // The ink sits 20 px above and 12 px left of the anchored word when it is drawn.
    const ink = { x: before.x - 12, y: before.y - 20 };
    const offset = offsetFrom(before, ink);

    root.insertBefore(document.createElement('p'), root.firstChild).textContent = 'new one';
    root.insertBefore(document.createElement('p'), root.firstChild).textContent = 'new two';
    root.querySelectorAll('p').forEach((p) => (p.style.margin = '0'));
    const after = placeNow(bravo, anchor)!;

    expect(after.y - before.y).toBe(56);
    const delta = followDelta(after, offset, ink);
    expect(delta).toEqual({ x: 0, y: 56 });
  });
});
