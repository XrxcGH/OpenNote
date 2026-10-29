// The shown page as page.json data, as it is right now, for export, print, and the gallery (Phase 6). The blocks come
// from the block layer, and each text box's Markdown from its editor, so typing that the core hasn't seen yet is in
// the export. The view and assets are the ones this window knows.
import type { AssetJson, BlockJson, PageJson } from '../../services/pages/types';
import { liveBlock } from './blocks/textBlock';
import { assetTable } from './images/assets';
import type { MountedPage } from './pagesApi';

const assetOf = (block: BlockJson) => (typeof block.data.asset === 'string' ? block.data.asset : null);

/** The page's JSON as the window shows it, with `title` as given (the tree owns the title). */
export function snapshotPage(mounted: MountedPage, title: string): PageJson {
  const table = assetTable(mounted.page);
  const blocks = mounted.layer
    .blocks()
    .map((block) => liveBlock(mounted.layer, block))
    .filter((block) => block.type !== 'text' || block.data.markdown !== '');
  const assets: Record<string, AssetJson> = {};
  for (const block of blocks) {
    const id = assetOf(block);
    const asset = id ? table.get(id) : undefined;
    if (id && asset) assets[id] = asset;
  }
  const initial = mounted.page.initial;
  return { ...initial, title, view: mounted.layout.view(), blocks, assets };
}
