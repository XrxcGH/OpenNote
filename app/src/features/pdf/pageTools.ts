// The PDF tools that work on the shown page (A1-34, A2-23, A3-19): the layers over its pictures, highlighting the
// selected words, sending a highlight to the notes, and how PDF pages and slides look in the Evening theme. Every
// change is one step in the page's own undo history.
import { isEnabled } from '../../app/flags';
import type { MountedPage } from '../page';
import type { BlockJson } from '../../services/pages/types';
import { t } from '../../strings/t';
import { announce, openMenu, showToast } from '../../ui';
import { addHighlight, changeHighlight, COLORS, quoteEdit, quoteMarkdown } from './highlights';
import type { Highlight, HighlightColor } from './highlights';
import { frameOf } from './noteSpace';
import { isPagePicture, lookOf, pdfOf, wordsOf } from './model';
import type { PdfLook, StoredWord } from './model';
import { attachOverlays } from './overlay';
import { shownTarget } from './target';

let lastColor: HighlightColor = 'candle';

/** The words of a picture's image the device read, as stored words, when text in images is on. */
async function readWords(src: string): Promise<StoredWord[] | null> {
  if (!isEnabled('pdf.textLayer')) return null;
  try {
    const { loadApi } = await import('../intel');
    const api = await loadApi();
    return await api.getImageWords(api.imageKey(src));
  } catch {
    return null;
  }
}

async function patch(mounted: MountedPage, block: string, data: Record<string, unknown>): Promise<void> {
  const target = await shownTarget(mounted);
  await target.send([{ edit: 'patchBlock', block, data }]);
}

/** Sets how every PDF page and slide on the shown page looks in the Evening theme. */
export async function setLook(mounted: MountedPage, look: PdfLook): Promise<number> {
  const pictures = mounted.layer.blocks().filter(isPagePicture);
  if (pictures.length === 0) return 0;
  const target = await shownTarget(mounted);
  await target.send(pictures.map((block) => ({ edit: 'patchBlock' as const, block: block.id, data: { look } })));
  announce(t(`pdf.look.announce.${look}`));
  return pictures.length;
}

/** The selected words of a PDF page's text layer: the block, the words, and the range. Null without one. */
export function selectedWords(
  mounted: MountedPage,
): { block: BlockJson; words: StoredWord[]; from: number; to: number } | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const spanOf = (node: Node | null) =>
    (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-index]');
  const start = spanOf(selection.anchorNode);
  const end = spanOf(selection.focusNode);
  const layer = start?.closest('[data-pdf-text]');
  if (!start || !end || !layer || end.closest('[data-pdf-text]') !== layer) return null;
  const id = layer.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
  const block = id ? mounted.layer.block(id) : null;
  if (!block) return null;
  const a = Number(start.dataset.index);
  const b = Number(end.dataset.index);
  return { block, words: wordsOf(block), from: Math.min(a, b), to: Math.max(a, b) };
}

/** Highlights the selected words of a PDF page in the last color used. */
export async function highlightSelection(mounted: MountedPage, color: HighlightColor = lastColor): Promise<boolean> {
  const selected = selectedWords(mounted);
  if (!selected || selected.words.length === 0) return false;
  const added = addHighlight(selected.block, selected.words, selected, color);
  if (!added) {
    showToast({ message: t('pdf.highlights.full') });
    return false;
  }
  lastColor = color;
  await patch(mounted, selected.block.id, added.patch);
  document.getSelection()?.removeAllRanges();
  announce(t('pdf.highlights.added', { color: t(`pdf.highlights.colors.${color}`) }));
  return true;
}

/** Adds the highlight as a quote beside the page, linked back to the spot. */
export async function sendToNotes(mounted: MountedPage, blockId: string, highlight: Highlight): Promise<void> {
  const block = mounted.layer.block(blockId);
  if (!block) return;
  const words = wordsOf(block);
  const top = words[highlight.from]?.[1] ?? 0;
  const markdown = quoteMarkdown(highlight, pdfOf(block), mounted.page.id, blockId);
  const target = await shownTarget(mounted);
  await target.send([quoteEdit(markdown, frameOf(block), top)]);
  showToast({ message: t('pdf.highlights.sent') });
}

function openHighlight(mounted: MountedPage, blockId: string, highlight: Highlight, anchor: HTMLElement): void {
  const block = () => mounted.layer.block(blockId);
  void openMenu({
    label: t('pdf.highlights.menu'),
    anchor,
    items: [
      { id: 'send', label: t('pdf.highlights.send'), onSelect: () => void sendToNotes(mounted, blockId, highlight) },
      ...COLORS.map((color, index) => ({
        id: color,
        label: t(`pdf.highlights.colors.${color}`),
        kind: 'radio' as const,
        checked: highlight.color === color,
        separatorBefore: index === 0,
        onSelect: () => {
          const current = block();
          if (current) void patch(mounted, blockId, changeHighlight(current, highlight.id, color));
        },
      })),
      {
        id: 'remove',
        label: t('pdf.highlights.remove'),
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          const current = block();
          if (current) void patch(mounted, blockId, changeHighlight(current, highlight.id, null));
        },
      },
    ],
  });
}

/** Copies the words of the selected picture, or of every PDF page on the page, to the clipboard. */
export async function copyPageText(mounted: MountedPage): Promise<void> {
  const { pageSelection } = await import('../page');
  const selected = new Set(pageSelection.get().blocks);
  const pictures = mounted.layer.blocks().filter((block) => block.type === 'image' && wordsOf(block).length > 0);
  const chosen = pictures.some((block) => selected.has(block.id))
    ? pictures.filter((b) => selected.has(b.id))
    : pictures;
  const text = chosen
    .map((block) => (typeof block.data.text === 'string' ? block.data.text : ''))
    .join('\n\n')
    .trim();
  if (!text) {
    showToast({ message: t('pdf.text.none') });
    return;
  }
  await navigator.clipboard.writeText(text);
  showToast({ message: t('pdf.text.copied') });
}

/** Attaches the layers to a page view. Returns the function that removes them. */
export function attachPageTools(mounted: MountedPage): () => void {
  return attachOverlays(mounted, mounted.viewport.world, {
    readWords,
    openHighlight: (block, highlight, anchor) => openHighlight(mounted, block, highlight, anchor),
    toggleOriginal: (block) => void setLook(mounted, lookOf(block) === 'original' ? 'dim' : 'original'),
  });
}
