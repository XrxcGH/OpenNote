// Attachments on a real page view: "Save a copy" from the command and from the card's menu, and the card keeping
// its badge where Windows can't draw a thumbnail (as in a plain browser).
import { vi, describe, expect, it, afterEach } from 'vitest';
import { executeCommand } from '../../../commands/registry';
import '../registrations/qol';
import { selectOnPage } from '../seams/selectionStore';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { assetTable } from '../images/assets';
import { showInserted } from '../images/insert';
import { attachmentEdits } from './attach';
import { thumbnailUrl } from './thumbnails';

interface TestHooks {
  exportsSaved(): { path: string; files: { path: string; length: number; text: string }[] }[];
}
const hooks = () => (window as unknown as { __OPENNOTE_TEST__: TestHooks }).__OPENNOTE_TEST__;

afterEach(async () => {
  selectOnPage({ blocks: [], strokes: [] });
  await cleanupPages();
});

async function pageWithAttachment() {
  const page = await renderPage({ fixture: textPageFixture('Files'), flags: { 'page.attachments': true } });
  // The memory page service holds the asset, so the page can find it again.
  const imported = await page.page.importImage({
    kind: 'bytes',
    bytes: new TextEncoder().encode('hello from the note').buffer,
    name: 'Lab report.pdf',
    mime: 'application/pdf',
  });
  assetTable(page.page).add(imported.id, imported.asset);
  const { edits, blocks } = attachmentEdits([imported], { kind: 'point', x: 40, y: 200 });
  const ack = await page.mounted.sync.send({ edits });
  showInserted(page.mounted, edits, ack.orderKeys);
  return { page, id: blocks[0] };
}

describe('attachments', () => {
  it('Save a copy writes the file through the Save dialog, from the command', async () => {
    const { id } = await pageWithAttachment();
    selectOnPage({ blocks: [id], strokes: [] });
    const before = hooks().exportsSaved().length;
    expect(await executeCommand('object.saveAttachmentCopy', undefined, 'palette')).toBe(true);
    await vi.waitFor(() => expect(hooks().exportsSaved().length).toBe(before + 1), {
      timeout: 15_000,
    });
    const saved = hooks().exportsSaved().at(-1)!;
    expect(saved.path.endsWith('Lab report.pdf')).toBe(true);
    expect(saved.files[0].text).toBe('hello from the note');
  });

  it('keeps the badge when Windows has no thumbnail', async () => {
    const { page, id } = await pageWithAttachment();
    expect(await thumbnailUrl(page.page.id, 'nothing', 'Lab report.pdf')).toBeNull();
    const card = page.mounted.layer.view(id)!.element;
    expect(card.querySelector('img')).toBeNull();
    expect(card.textContent).toContain('PDF');
  });
});
