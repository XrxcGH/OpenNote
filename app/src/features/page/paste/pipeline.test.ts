// @vitest-environment jsdom
// The paste pipeline on a real page view over the memory service: text goes into the focused editor, tables and
// images become blocks after it, Ctrl+Shift+V keeps text plain, and a web address over selected words links them.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Edit } from '../../../services/pages/types';
import { initFlags } from '../../../app/flags';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { md } from '../test/builders';
import { bindFacts, textSha256 } from './facts';
import { orderBetween, ordersBetween } from './order';
import { dataUrlBytes, runPaste, splitImages } from './pipeline';
import type { PasteRequest } from './pipeline';
import { sanitizePaste } from './sanitize';

// A 1 by 1 PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeAll(() => {
  // jsdom has no layout; ProseMirror measures ranges when it scrolls a selection into view.
  const empty = () => new DOMRect(0, 0, 0, 0);
  Range.prototype.getBoundingClientRect ??= empty;
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
});
afterEach(cleanupPages);

const request = (next: Partial<PasteRequest>): PasteRequest => ({
  html: null,
  text: null,
  files: [],
  plain: false,
  origin: 'paste',
  ...next,
});

async function pageWith(markdown: string) {
  const fixture = textPageFixture(markdown);
  const block = fixture.page.blocks[0].id;
  const page = await renderPage({ fixture, flags: { 'page.images': true, 'page.pasteExtras': true } });
  // jsdom can't build object URLs from the memory service's bytes.
  Object.assign(page.page, { assetUrl: (asset: string) => `blob:${asset}` });
  const editor = page.mounted.pool.mount(block, { kind: 'end' }, 'target')!;
  editor.commands.focus('end', { scrollIntoView: false });
  return { page, block, editor };
}

const edits = (sent: readonly { edits: Edit[] }[]) => sent.flatMap((batch) => batch.edits);

describe('the paste pipeline', () => {
  it('puts text into the focused editor at the caret', async () => {
    const { page, block } = await pageWith('Hello');
    await runPaste(page.mounted, request({ text: 'there\nand more' }), null);
    expect(page.markdown(block)).toBe('Hellothere\n\nand more');
  });

  it('parses Markdown', async () => {
    const { page, block } = await pageWith('');
    await runPaste(page.mounted, request({ text: '# Title\n\n- **one**' }), null);
    expect(page.markdown(block)).toBe('# Title\n\n- **one**');
  });

  it('keeps text plain with Ctrl+Shift+V', async () => {
    const { page, block } = await pageWith('');
    await runPaste(page.mounted, request({ text: '# Title', plain: true }), null);
    expect(page.markdown(block)).toBe('\\# Title');
  });

  it('makes a table block after the text', async () => {
    const { page } = await pageWith('Intro');
    const html = '<p>Before</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    await runPaste(page.mounted, request({ html, text: 'Before\nA\tB\n1\t2' }), null);
    const table = edits(page.sent()).find((edit) => edit.edit === 'insertBlock' && edit.block.type === 'table');
    expect(table).toBeDefined();
  });

  it('imports an image that stands alone as an image block, after its asset', async () => {
    const { page } = await pageWith('Intro');
    await runPaste(page.mounted, request({ html: `<p>Look:</p><p><img src="${PNG}" alt="A dot"></p>` }), null);
    const all = edits(page.sent());
    const asset = all.findIndex((edit) => edit.edit === 'addAsset');
    const image = all.findIndex((edit) => edit.edit === 'insertBlock' && edit.block.type === 'image');
    expect(asset).toBeGreaterThanOrEqual(0);
    expect(image).toBeGreaterThan(asset);
    const inserted = all[image];
    expect(inserted.edit === 'insertBlock' && inserted.block.data).toMatchObject({ alt: 'A dot' });
  });

  it('links a web image that could not be saved, with its description', async () => {
    const { page } = await pageWith('Intro');
    await runPaste(page.mounted, request({ html: '<p><img src="https://example.com/a.png" alt="Remote"></p>' }), null);
    const text = edits(page.sent()).find((edit) => edit.edit === 'insertBlock' && edit.block.type === 'text');
    expect(text?.edit === 'insertBlock' && text.block.data.markdown).toBe('[Remote](https://example.com/a.png)');
  });

  it('links selected words to a pasted web address', async () => {
    const marked = md('see [the docs] here');
    const { page, block, editor } = await pageWith('see the docs here');
    editor.commands.setTextSelection({ from: marked.anchor, to: marked.head });
    await runPaste(page.mounted, request({ text: 'https://example.com/docs' }), null);
    await page.mounted.sync.flushAll('command');
    expect(page.markdown(block)).toBe('see [the docs](https://example.com/docs) here');
  });

  it('pastes image files as image blocks', async () => {
    initFlags('dev', { 'page.editor': true, 'page.images': true });
    const { page } = await pageWith('Intro');
    const file = new File([dataUrlBytes(PNG)!.bytes], 'shot.png', { type: 'image/png' });
    await runPaste(page.mounted, request({ files: [file] }), null);
    expect(edits(page.sent()).some((edit) => edit.edit === 'insertBlock' && edit.block.type === 'image')).toBe(true);
  });
});

describe('splitting images out of text', () => {
  it('turns images into image pieces after their block, and emoji pictures into their text', () => {
    const html = `<p>a <img src="${PNG}" alt="🙂"> b <img src="${PNG}" alt="A dot"></p><p><img src="${PNG}" alt="x y"></p>`;
    const pieces = splitImages(sanitizePaste({ html }).pieces);
    expect(pieces.map((piece) => piece.kind)).toEqual(['text', 'image', 'image']);
    expect(pieces[0].kind === 'text' && pieces[0].doc.textContent.trim()).toBe('a 🙂 b');
    expect(pieces[1].kind === 'image' && pieces[1].request.alt).toBe('A dot');
  });
});

describe('clipboard facts', () => {
  const facts = { sequence: 1, sourceUrl: 'https://example.com/', hasOneNote: false, wordImages: [] };

  it('belong to a paste only when its text hashes the same, with CRLF as LF', async () => {
    const textSha256Value = await textSha256('one\ntwo');
    expect(await textSha256('one\r\ntwo')).toBe(textSha256Value);
    expect(await bindFacts('one\r\ntwo', { ...facts, textSha256: textSha256Value })).not.toBeNull();
    expect(await bindFacts('other', { ...facts, textSha256: textSha256Value })).toBeNull();
    expect(await bindFacts('one', { ...facts, textSha256: null })).toBeNull();
  });
});

describe('provisional order keys', () => {
  it('sort between their neighbors', () => {
    for (const [low, high] of [
      ['a0', 'a1'],
      ['a0', 'a0V'],
      ['a0', null],
      ['Zz', 'a'],
    ] as const) {
      const key = orderBetween(low, high);
      expect(key > low).toBe(true);
      if (high) expect(key < high).toBe(true);
    }
    const keys = ordersBetween('a0', 'a1', 5);
    expect([...keys].sort()).toEqual(keys);
  });
});
