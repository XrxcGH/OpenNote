// @vitest-environment jsdom
// A link, a search result, or a tag line that points inside a folded heading opens the fold before it scrolls.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { foldsOf, setFolds } from '../../../editor/commands/fold';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { flash } from './flash';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
  vi.useRealTimers();
});

describe('flash', () => {
  it('unfolds the heading that hides its target, then scrolls to it', () => {
    vi.useFakeTimers();
    mounted = mountEditor('## A\n\nHidden text');
    mounted.editor.view.dispatch(setFolds(mounted.editor.state.tr, [0]));
    const target = [...mounted.root.querySelectorAll('p')].find((node) => node.textContent === 'Hidden text')!;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    flash(target);
    expect(foldsOf(mounted.editor.state)).toEqual([]);
    expect(scroll).toHaveBeenCalledOnce();
    expect(target.classList.length).toBeGreaterThan(0);
  });
});
