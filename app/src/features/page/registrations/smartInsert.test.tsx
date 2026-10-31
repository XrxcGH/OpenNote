// A tool's insert request with no caret in the page goes at the end of the page's last text block.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSERT_EVENT } from '../../tools/flags';
import { shownMedia } from '../images/shown';
import './smart';

afterEach(() => shownMedia.set(null));

describe('page insert listener', () => {
  it('puts an answer line at the end of the last text block when no editor has the caret', () => {
    const inserted: unknown[] = [];
    const chain = {
      focus: () => chain,
      insertContentAt: (range: unknown, text: unknown) => {
        inserted.push({ range, text });
        return chain;
      },
      run: () => true,
    };
    const editor = { state: { selection: { from: 7, to: 7 }, doc: { textBetween: () => '' } }, chain: () => chain };
    const mount = vi.fn(() => editor);
    const blocks = [
      { id: 'first', type: 'text' },
      { id: 'last', type: 'text' },
    ];
    shownMedia.set({ layer: { blocks: () => blocks }, pool: { mount } } as unknown as Parameters<
      typeof shownMedia.set
    >[0]);
    const detail = { text: 'p = 0.03', handled: false };
    window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail }));
    expect(mount).toHaveBeenCalledWith('last', { kind: 'end' }, 'target');
    expect(inserted).toEqual([{ range: { from: 7, to: 7 }, text: 'p = 0.03' }]);
    expect(detail.handled).toBe(true);
  });
});
