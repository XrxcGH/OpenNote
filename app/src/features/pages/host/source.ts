// The shown page, ready for export: its data as `ExportPage`, the title and place for headers, and where each asset
// loads from. Everything export, print, the gallery, and slides show about the open page comes through here.
import { shownAssetUrl, shownMounted, snapshotShownPage } from '../../page';
import type { NodeId, NotesService } from '../../../services/notes';
import { titleOf } from '../../tree';
import { readExportPage, type ExportPage } from '../export';
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

/** The shown page as export data, or null when no page is shown. */
export async function collectSource(notes: NotesService, language = 'en'): Promise<PageSource | null> {
  const mounted = shownMounted.get();
  if (!mounted) return null;
  const pageId = mounted.page.id;
  const place = await placeOf(notes, pageId);
  const json = await snapshotShownPage(place.title);
  if (!json) return null;
  const strokes = await collectStrokes(pageId);
  const page = readExportPage(json, strokes, language);
  const assetUrls: Record<string, string> = {};
  for (const id of Object.keys(page.assets)) {
    const url = shownAssetUrl(id);
    if (url) assetUrls[id] = url;
  }
  return { pageId, ...place, page, assetUrls };
}
