// The shown page, ready for export: its data as `ExportPage`, the title and place for headers, and where each asset
// loads from. Everything export, print, the gallery, and slides show about the open page comes through here.
import { shownAssetUrl, shownMounted, snapshotShownPage } from '../../page';
import type { NodeId, NotesService } from '../../../services/notes';
import { titleOf } from '../../tree';
import { readExportPage, withBlanks, type ExportBlock, type TapeBox, type ExportPage } from '../export';
import { t } from '../../../strings/t';
import { tapeBlanksOn } from './tapePref';
import { collectStrokes } from './strokes';

export interface PageSource {
  readonly pageId: string;
  readonly title: string;
  readonly notebook: string;
  readonly section: string;
  readonly page: ExportPage;
  /** Where each asset loads from, by asset ID. */
  readonly assetUrls: Readonly<Record<string, string>>;
}

/** The names of the page's section and notebook, for headers and footers. */
async function placeOf(
  notes: NotesService,
  pageId: string,
): Promise<{ title: string; notebook: string; section: string }> {
  const node = await notes.get(pageId as NodeId).catch(() => null);
  let section = '';
  let notebook = '';
  let parent = node?.parentId ? await notes.get(node.parentId).catch(() => null) : null;
  while (parent) {
    if (parent.kind === 'section' && !section) section = titleOf(parent);
    if (parent.kind === 'notebook') notebook = titleOf(parent);
    parent = parent.parentId ? await notes.get(parent.parentId).catch(() => null) : null;
  }
  return { title: node ? titleOf(node) : '', notebook, section };
}

/** The box of every block as the page view laid it out, in page units. */
function shownBoxes(): Map<string, TapeBox> {
  const mounted = shownMounted.get();
  const boxes = new Map<string, TapeBox>();
  if (!mounted) return boxes;
  for (const block of mounted.layer.blocks()) {
    const element = mounted.layer.view(block.id)?.element;
    if (element) boxes.set(block.id, { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight });
  }
  return boxes;
}

function tapeLabels() {
  return {
    answerKey: t('pagesPlus.tape.answerKey'),
    picture: t('pagesPlus.tape.picture'),
    drawing: t('pagesPlus.tape.drawing'),
    table: t('pagesPlus.tape.table'),
  };
}

/** Draws each diagram, so print, PDF, pictures, and web pages carry it as a vector drawing. A diagram that can't be drawn stays as text. */
async function withDiagrams(page: ExportPage): Promise<ExportPage> {
  if (!page.blocks.some((block) => block.type === 'diagram')) return page;
  const { drawDiagram } = await import('../../math');
  const blocks: ExportBlock[] = [];
  for (const block of page.blocks) {
    if (block.type !== 'diagram') {
      blocks.push(block);
      continue;
    }
    const drawn = await drawDiagram(block.source).catch(() => null);
    blocks.push(drawn?.ok ? { ...block, svg: drawn.svg } : block);
  }
  return { ...page, blocks };
}

/** The shown page as export data, or null when no page is shown. */
export async function collectSource(notes: NotesService, language = 'en'): Promise<PageSource | null> {
  const mounted = shownMounted.get();
  if (!mounted) return null;
  const pageId = mounted.page.id;
  const place = await placeOf(notes, pageId);
  const json = await snapshotShownPage(place.title);
  if (!json) return null;
  const strokes = await collectStrokes(pageId);
  const read = await withDiagrams(readExportPage(json, strokes, language));
  const page = tapeBlanksOn() ? withBlanks(read, shownBoxes(), tapeLabels()) : read;
  const assetUrls: Record<string, string> = {};
  for (const id of Object.keys(page.assets)) {
    const url = shownAssetUrl(id);
    if (url) assetUrls[id] = url;
  }
  return { pageId, ...place, page, assetUrls };
}
