// The shown page as export, print, and the gallery read it. Typing goes to the editor and the page service, not to the
// block layer's copy of the block, so the snapshot must take each text box's live text.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupPages, renderPage } from './test/harness';
import { textPageFixture } from './test/fixtures';
import type { PageFixture } from './test/fixtures';
import { snapshotPage } from './snapshot';

afterEach(cleanupPages);

const textOf = (json: ReturnType<typeof snapshotPage>) =>
  json.blocks.filter((block) => block.type === 'text').map((block) => block.data.markdown);

describe('the snapshot of the shown page', () => {
  it('has what was typed into a text box since the page opened', async () => {
    const fixture = textPageFixture('Opened with this');
    const harness = await renderPage({ fixture });
    await harness.type(fixture.page.blocks[0].id, ' and typed this');
    expect(textOf(snapshotPage(harness.mounted, 'Test page'))).toEqual(['Opened with this and typed this']);
  });

  it('has the text typed into the empty box of a new page', async () => {
    const empty = textPageFixture('');
    const fixture: PageFixture = { ...empty, page: { ...empty.page, blocks: [] } };
    const harness = await renderPage({ fixture });
    const draft = harness.mounted.layer.blocks().find((block) => block.type === 'text');
    expect(draft).toBeDefined();
    expect(textOf(snapshotPage(harness.mounted, 'Test page'))).toEqual([]);
    await harness.type(draft!.id, 'Typed line of text');
    expect(textOf(snapshotPage(harness.mounted, 'Test page'))).toEqual(['Typed line of text']);
  });
});
