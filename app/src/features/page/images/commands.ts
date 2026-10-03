// What WP5's commands run (PLAN.md section 9.3): Insert image, Crop image, Alt text, and Copy as Markdown. The
// registrations load this module on first use.
import { serializeTextBlock } from '../../../editor/markdown';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { selectedImage } from '../blocks/imageBlock';
import { pageSelection } from '../seams/selectionStore';
import { pickImages } from './insert';
import { shownMedia } from './shown';

export async function insertImage(): Promise<void> {
  const mounted = shownMedia.get();
  if (!mounted || mounted.page.readOnly) return;
  await pickImages(mounted, mounted.host.flag('page.heicImport'));
}

export async function cropImage(): Promise<void> {
  const image = selectedImage();
  if (!image) return;
  const { startCrop } = await import('./cropMode');
  startCrop(image);
}

export async function altText(): Promise<void> {
  const image = selectedImage();
  if (!image) return;
  const { editAltText } = await import('./AltTextDialog');
  await editAltText(image);
}

/** The Markdown of the editor's selection, or of the selected blocks. */
export async function selectionMarkdown(): Promise<string | null> {
  const mounted = shownMedia.get();
  if (!mounted) return null;
  const editor = mounted.pool.active()?.editor;
  if (editor && !editor.state.selection.empty) {
    const doc = editor.schema.topNodeType.createAndFill(null, editor.state.selection.content().content);
    return doc ? serializeTextBlock(doc, mounted.cache) : null;
  }
  const blocks = pageSelection.get().blocks;
  if (blocks.length === 0) return null;
  const { writeBlocks } = await import('../paste/blocks');
  const data = new DataTransfer();
  return writeBlocks(mounted, blocks, data) ? data.getData('text/plain') : null;
}

/** "Copy as Markdown": the canonical Markdown as plain text, for Obsidian and other Markdown tools. */
export async function copyAsMarkdown(): Promise<void> {
  const markdown = await selectionMarkdown();
  if (markdown === null) {
    announce(t('paste.nothingToCopy'));
    return;
  }
  await navigator.clipboard.writeText(markdown);
  announce(t('paste.copiedMarkdown'));
}
