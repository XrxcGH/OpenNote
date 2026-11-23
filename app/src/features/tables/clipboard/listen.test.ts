// @vitest-environment jsdom
// The table's clipboard runs before the page's listeners, so the page's code needs no table-cell hook (G5).
import { afterEach, describe, expect, it } from 'vitest';
import { listenFirst } from './attach';

let stops: (() => void)[] = [];
afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  document.body.replaceChildren();
});

/** A page container with a capture listener, as the page's own paste listener is, and a table editor inside it. */
function page() {
  const container = document.createElement('div');
  const editor = document.createElement('div');
  const other = document.createElement('div');
  container.append(editor, other);
  document.body.append(container);
  const seen: string[] = [];
  container.addEventListener('paste', () => seen.push('page'), true);
  editor.addEventListener('paste', () => seen.push('editor'));
  return { editor, other, seen };
}

const paste = (target: Element): Event => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe('listenFirst', () => {
  it('takes a paste before the page container and the editor see it', () => {
    const { editor, seen } = page();
    stops.push(listenFirst(document, (t) => t instanceof Node && editor.contains(t), { paste: () => true }));
    const event = paste(editor);
    expect(seen).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a paste it does not take to the page', () => {
    const { editor, seen } = page();
    stops.push(listenFirst(document, (t) => t instanceof Node && editor.contains(t), { paste: () => false }));
    expect(paste(editor).defaultPrevented).toBe(false);
    expect(seen).toEqual(['page', 'editor']);
  });

  it('ignores events outside its table and stops listening when asked', () => {
    const { editor, other, seen } = page();
    let calls = 0;
    const stop = listenFirst(document, (t) => t instanceof Node && editor.contains(t), {
      paste: () => (calls++, true),
    });
    paste(other);
    stop();
    paste(editor);
    expect(calls).toBe(0);
    expect(seen).toEqual(['page', 'page', 'editor']);
  });
});
