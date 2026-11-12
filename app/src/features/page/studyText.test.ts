// "Make flashcards from this page" reads each text box as it is now (B2-B12-1). The block layer keeps a box's text as
// it was opened, so text typed since lives only in the box's editor until the page is opened again.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockJson } from '../../services/pages/types';

const requestCards = vi.fn();
const said = vi.fn();
const typed = new Map<string, string>();

vi.mock('./blocks/textBlock', () => ({
  liveBlock: (_layer: unknown, block: BlockJson) =>
    typed.has(block.id) ? { ...block, data: { ...block.data, markdown: typed.get(block.id) } } : block,
}));
vi.mock('../study', () => ({ requestCards }));
vi.mock('../tools', () => ({ openTool: vi.fn() }));
vi.mock('./registrations/say', () => ({ say: said }));

const { commands } = await import('../../registries');
const { shownMounted } = await import('./pagesApi');
await import('./registrations/qolStudy');

const block: BlockJson = {
  id: 'b1',
  type: 'text',
  order: 'a',
  created: '',
  modified: '',
  data: { markdown: '' },
};

beforeEach(() => {
  requestCards.mockClear();
  said.mockClear();
  typed.clear();
  shownMounted.set({
    page: { id: 'p1', initial: { title: 'Cells' } },
    layer: { blocks: () => [block], view: () => null },
  } as never);
});

describe('Make flashcards from this page', () => {
  it('uses the text typed since the page opened', async () => {
    typed.set('b1', 'Mitochondria are the organelles that make energy.');
    await commands.get('study.generatePage')?.run({} as never, undefined as never);
    expect(said).not.toHaveBeenCalled();
    expect(requestCards).toHaveBeenCalledWith('Mitochondria are the organelles that make energy.', 'Cells');
  });

  it('still says so when the page has no text', async () => {
    await commands.get('study.generatePage')?.run({} as never, undefined as never);
    expect(requestCards).not.toHaveBeenCalled();
    expect(said).toHaveBeenCalledOnce();
  });
});
