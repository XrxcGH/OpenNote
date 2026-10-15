// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CONTRACT_PAGE } from '../../../services/pages/contract';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { NewBlock } from '../../../services/pages/types';
import { blockRenderers } from '../registries';
import '../registrations/qolStudy';

const ID = '01k6pane1000000000000000b1';

describe('panel block types', () => {
  // Beta 4: Insert mind map, flashcards, study tape, and diagram failed with "the block type is unknown", because
  // the panels used bare type names that the core refuses. The memory service follows the core's type rules.
  const types = blockRenderers
    .list()
    .filter((def) => def.id.startsWith('panel.'))
    .flatMap((def) => def.types);

  it('registers the four panel blocks', () => {
    expect(types).toHaveLength(4);
  });

  it.each(types)('%s can be inserted and edited', async (type) => {
    const service = createMemoryPageService([{ page: CONTRACT_PAGE }]);
    const page = await service.open(CONTRACT_PAGE.id, { viewport: null });
    const block = { id: ID, type: type as NewBlock['type'], data: { hidden: true }, fallback: { markdown: 'Panel' } };
    await page.send({ edits: [{ edit: 'insertBlock', block }] });
    await page.send({ edits: [{ edit: 'patchBlock', block: ID, data: { hidden: false } }] });
    await page.close();
    const held = await service.open(CONTRACT_PAGE.id, { viewport: null });
    expect(held.initial.blocks.find((candidate) => candidate.id === ID)?.data).toEqual({ hidden: false });
    await held.close();
  });
});
