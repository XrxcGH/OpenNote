// Reading the text of pages for the document-structure tools. The shown page is read as the page view holds it, so text
// that was just typed counts; other pages are read through a short visit by the page service.
import { getLocation } from '../../app/location';
import { getNode, selectedNodes, treeStore } from '../tree';
import type { SheetPage } from './formulaSheet';
import { loadTemplates, shownMounted, snapshotShownPage } from '../page';
import type { BlockJson } from '../../services/pages/types';

const textsOf = (blocks: readonly Pick<BlockJson, 'type' | 'data'>[]): string[] =>
  blocks.filter((b) => b.type === 'text').map((b) => String(b.data.markdown ?? ''));

/** The shown page's id, title, and text blocks as they are now, typed text included, or null when no page is shown. */
export async function shownPage(): Promise<(SheetPage & { id: string }) | null> {
  const mounted = shownMounted.get();
  if (!mounted) return null;
  const title = getNode(mounted.page.id)?.title ?? mounted.page.initial.title ?? '';
  const json = await snapshotShownPage(title);
  if (!json) return null;
  const blocks = [...json.blocks].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return { id: mounted.page.id, title, texts: textsOf(blocks) };
}

/** The shown page's text, joined, or an empty string. */
export const shownMarkdown = async (): Promise<string> => (await shownPage())?.texts.join('\n\n') ?? '';

/** One page's title and text blocks. The shown page is read live. */
export async function pageTexts(id: string, title: string): Promise<SheetPage> {
  const shown = await shownPage();
  if (shown?.id === id) return shown;
  return { title, texts: textsOf(await (await loadTemplates()).readBlocks(id)) };
}

export interface PageChoice {
  readonly id: string;
  readonly title: string;
}

/** The pages selected in the page list (two or more), else none. */
export function selectedPages(): PageChoice[] {
  return (selectedNodes() ?? []).filter((n) => n.kind === 'page').map((n) => ({ id: n.id, title: n.title }));
}

/** The pages of the open section, in tree order, with their subpages. */
export function sectionPages(): PageChoice[] {
  const location = getLocation();
  if (location.view !== 'workspace' || !location.sectionId) return [];
  const state = treeStore.get();
  const out: PageChoice[] = [];
  const walk = (parent: string): void => {
    for (const id of state.children[parent] ?? []) {
      const one = getNode(id);
      if (one?.kind !== 'page') continue;
      out.push({ id: one.id, title: one.title });
      walk(one.id);
    }
  };
  walk(location.sectionId);
  return out;
}
