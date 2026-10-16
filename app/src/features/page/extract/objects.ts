// Extract for what the lasso or the object selection holds: handwriting and blocks. They move to a new subpage and a
// link takes their place, as typed text does. Blocks that carry a file (pictures and attachments) stay where they are,
// because their files belong to this page; the message says how many stayed. The source page changes through a visit of
// its own, so the page view and the ink view show it as they show a change from another window.
import { commandContext } from '../../../commands/registry';
import { decodeRecords, encodeRecords } from '../../../core/ink/codec';
import type { InkRecord } from '../../../core/ink/records';
import { newId } from '../../../editor/ids';
import { exportInkSources } from '../../../registries';
import type { NodeId } from '../../../services/notes/types';
import type { BlockJson, Edit, NewBlock, PageId } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { shownMounted } from '../pagesApi';
import { pagesClient } from '../runtime';
import { pageSelection, selectOnPage } from '../seams/selectionStore';
import { byOrder } from '../readingOrder/order';
import { finishChange } from './changes';
import { createPage, placeAfter, shownPageNode } from './place';
import { extractTitle } from './sections';

/** Blocks whose data is only data, so a copy in another page is the same block. */
const HAS_FILE = new Set(['image', 'file', 'ink']);

/** The records of the chosen strokes, read from whatever holds the page's ink. */
async function recordsOf(page: string, ids: ReadonlySet<string>): Promise<InkRecord[]> {
  const found: InkRecord[] = [];
  for (const source of exportInkSources.list()) {
    const bytes = await source.records(page).catch(() => null);
    if (!bytes) continue;
    for (const record of decodeRecords(bytes, { verify: false })) {
      if (record.kind === 'stroke' && ids.has(record.stroke.id)) found.push(record);
    }
  }
  return found;
}

const copyOf = (block: BlockJson): NewBlock =>
  ({
    id: newId(),
    type: block.type,
    data: structuredClone(block.data),
    ...(block.fallback ? { fallback: structuredClone(block.fallback) } : {}),
    ...(block.frame ? { frame: structuredClone(block.frame) } : {}),
  }) as NewBlock;

/** Whether the selection holds anything this command moves. */
export function hasObjectSelection(): boolean {
  const selection = pageSelection.get();
  return selection.blocks.length > 0 || selection.strokes.length > 0;
}

/** Moves the selected blocks and handwriting to a new subpage and leaves a link where they were. */
export async function extractObjects(): Promise<void> {
  const mounted = shownMounted.get();
  if (!mounted || mounted.page.readOnly) return;
  const selection = pageSelection.get();
  const { notes } = commandContext('menu');
  const page = await shownPageNode(notes);
  if (!page) return;
  await mounted.sync.flushAll('command');
  const chosen = new Set(selection.blocks);
  const blocks = mounted.layer
    .blocks()
    .filter((block) => chosen.has(block.id))
    .sort(byOrder);
  const moving = blocks.filter((block) => !HAS_FILE.has(block.type));
  const stayed = blocks.length - moving.length;
  const strokes = await recordsOf(page.id, new Set(selection.strokes));
  if (moving.length === 0 && strokes.length === 0) {
    return announce(t(stayed > 0 ? 'pageExtras.extract.filesStay' : 'pageExtras.extract.nothingSelected'));
  }
  const firstText = moving.find((block) => block.type === 'text');
  const title = extractTitle(
    typeof firstText?.data.markdown === 'string' ? firstText.data.markdown : '',
    t('pageExtras.extract.untitledObjects'),
  );
  const created = await createPage(notes, await placeAfter(notes, page, true), title);
  const copies = moving.map(copyOf);
  const layer = strokes.length > 0 ? newId() : null;
  const intoNew: Edit[] = [
    ...copies.map((block): Edit => ({ edit: 'insertBlock', block })),
    ...(layer ? [{ edit: 'insertBlock', block: { id: layer, type: 'ink', data: { role: 'layer' } } } as Edit] : []),
  ];
  const bytes = layer
    ? encodeRecords(
        strokes.map((record) =>
          record.kind === 'stroke' ? { ...record, stroke: { ...record.stroke, block: layer } } : record,
        ),
      )
    : undefined;
  await withPage(created.id, (open) => open.send({ edits: intoNew, ...(bytes ? { strokes: bytes } : {}) }));
  const linkBlock: NewBlock = {
    id: newId(),
    type: 'text',
    data: { markdown: `[${title.replace(/[[\]\\]/g, ' ')}](opennote:page/${created.id})` },
  };
  const strokeIds = strokes.map((record) => (record.kind === 'stroke' ? record.stroke.id : ''));
  const last = blocks.at(-1)?.id;
  const out: Edit[] = [
    ...(strokeIds.length > 0 ? [{ edit: 'removeStrokes', strokes: strokeIds } as Edit] : []),
    ...(moving.length > 0 ? [{ edit: 'deleteBlocks', blocks: moving.map((block) => block.id) } as Edit] : []),
    { edit: 'insertBlock', block: linkBlock, ...(last && !moving.some((m) => m.id === last) ? { after: last } : {}) },
  ];
  await withPage(page.id, (open) => open.send({ edits: out }));
  selectOnPage({ blocks: [], strokes: [] });
  const message = t(stayed > 0 ? 'pageExtras.extract.doneObjectsStayed' : 'pageExtras.extract.done', {
    title,
    stayed,
  });
  announce(message);
  const originals = moving;
  finishChange(notes, {
    created: [created.id],
    revert: async () => {
      await withPage(page.id, async (open) => {
        const back: Edit[] = [
          ...originals.map((block): Edit => ({ edit: 'insertBlock', block: { ...copyOf(block), id: block.id } })),
          { edit: 'deleteBlocks', blocks: [linkBlock.id] },
        ];
        await open.send({ edits: back, ...(strokes.length > 0 ? { strokes: encodeRecords(strokes) } : {}) });
      });
    },
    message,
    history: { pages: [page.id], name: t('pageExtras.history.extract', { title }) },
  });
}

async function withPage<T>(
  id: NodeId,
  work: (open: Awaited<ReturnType<ReturnType<typeof pagesClient>['open']>>) => Promise<T>,
): Promise<T> {
  const open = await pagesClient().open(id as unknown as PageId, { viewport: null });
  try {
    return await work(open);
  } finally {
    await open.close();
  }
}
