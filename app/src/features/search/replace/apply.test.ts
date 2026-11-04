// The page on screen takes a replace through its own queue (full walk A-A04-8). A second session's undo history goes
// when it closes, so the page could undo the replace but never redo it.
import { describe, expect, it, vi } from 'vitest';
import type { PagesClient } from '../../../platform/types';
import type { BlockJson, Edit } from '../../../services/pages/types';
import { applyReplace, undoReplace } from './apply';
import type { ShownTarget } from './apply';
import type { Match } from './plan';

const AT = '2026-10-01T09:00:00.000Z';
const block = (markdown: string): BlockJson => ({
  id: 'b1',
  type: 'text',
  order: 'a',
  created: AT,
  modified: AT,
  data: { markdown },
});
const match = (page: string): Match =>
  ({
    id: 'm',
    page,
    pageTitle: 'P',
    block: 'b1',
    blockType: 'text',
    field: { kind: 'text' },
    start: 0,
    end: 3,
    found: 'fig',
  }) as unknown as Match;

function shown(markdown: string): ShownTarget & { sent: Edit[][]; shown: Edit[] } {
  let text = markdown;
  const target = {
    id: 'shown',
    sent: [] as Edit[][],
    shown: [] as Edit[],
    flush: vi.fn(async () => undefined),
    blocks: () => [block(text)],
    async send(edits: Edit[]) {
      target.sent.push(edits);
      const set = edits.find((edit) => edit.edit === 'setText');
      if (set?.edit === 'setText') text = set.markdown;
    },
    show: (edit: Edit) => void target.shown.push(edit),
  };
  return target;
}

describe('replace on the page on screen', () => {
  it('goes through the page’s queue and shows at once, and so does its Undo', async () => {
    const pages = { open: vi.fn() } as unknown as PagesClient;
    const target = shown('fig fig');
    const done = await applyReplace(pages, [match('shown')], 'date', target);
    expect(pages.open).not.toHaveBeenCalled();
    expect(target.flush).toHaveBeenCalled();
    expect(target.sent).toEqual([[{ edit: 'setText', block: 'b1', markdown: 'date fig' }]]);
    expect(target.shown).toEqual(target.sent[0]);
    expect(done.matches).toBe(1);
    expect(await undoReplace(pages, done.written, target)).toBe(1);
    expect(target.sent[1]).toEqual([{ edit: 'setText', block: 'b1', markdown: 'fig fig' }]);
  });

  it('opens a page of its own for any other page', async () => {
    const send = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const pages = {
      open: vi.fn(async () => ({ initial: { blocks: [block('fig')] }, send, close })),
    } as unknown as PagesClient;
    await applyReplace(pages, [match('other')], 'date', shown('fig'));
    expect(send).toHaveBeenCalledWith({ edits: [{ edit: 'setText', block: 'b1', markdown: 'date' }] });
    expect(close).toHaveBeenCalled();
  });
});
