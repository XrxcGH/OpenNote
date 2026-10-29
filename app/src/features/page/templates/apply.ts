// Putting templates and series pages to work: listing the templates, reading a page's blocks, writing blocks into
// a page, and the hook that fills a page the moment "New page" creates it. A page other than the shown one is
// opened by the page service for a moment, like the date line under a new page's title.
import { commandContext, executeCommand } from '../../../commands/registry';
import type { CommandContext } from '../../../commands/types';
import { dateTimeText } from '../../../editor/commands/insertDate';
import { newId } from '../../../editor/ids';
import type { NodeId } from '../../../services/notes/types';
import type { BlockJson, Edit, NewBlock, PageId } from '../../../services/pages/types';
import { formatDate, formatTime } from '../../../strings/format';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { currentBlock } from '../images/insert';
import type { MountedPage } from '../mount';
import { shownMounted } from '../pagesApi';
import { pageExtrasPrefs } from '../qol/prefs';
import { byOrder } from '../readingOrder/order';
import { pagesClient } from '../runtime';
import { isEnabled } from '../../../app/flags';
import { builtinBlocks, builtinInfos } from '../../docstructure';
import { fromTemplate, pageLink, seriesBase, seriesBlocks } from './model';
import type { Placeholders, TemplateCursor } from './model';
import { newSeriesId, seriesIdInView, setSeries } from './seriesList';
import { sessionTemplates, TEMPLATE_TAG } from './state';

export interface TemplateInfo {
  id: string;
  title: string;
}

/** The pages tagged as templates, by title. */
export async function listTemplates(): Promise<TemplateInfo[]> {
  const search = (() => {
    try {
      return commandContext('menu').platform.search;
    } catch {
      return null;
    }
  })();
  const found = new Map<string, string>();
  if (search) {
    const byFilter = await search.search({ text: '', filters: { tags: [TEMPLATE_TAG] }, limit: 100 }).catch(() => null);
    const byText = byFilter?.hits.length
      ? byFilter
      : await search.search({ text: `tag:${TEMPLATE_TAG}`, limit: 100 }).catch(() => null);
    for (const hit of byText?.hits ?? []) found.set(hit.page, hit.title);
  }
  const { added, removed } = sessionTemplates();
  for (const [id, title] of added) found.set(id, title);
  for (const id of removed) found.delete(id);
  const own = [...found].map(([id, title]) => ({ id, title: title.trim() || t('pageExtras.templates.untitled') }));
  // The problem set, Cornell notes, and lab report templates come with the app.
  return isEnabled('doc.problemTemplates') ? [...builtinInfos(), ...own] : own;
}

/** The blocks of a page in reading order, read through a short visit by the page service. */
export async function readBlocks(page: string): Promise<BlockJson[]> {
  const built = builtinBlocks(page);
  if (built) return built;
  const open = await pagesClient().open(page as PageId, { viewport: null });
  try {
    return [...open.initial.blocks].sort(byOrder);
  } finally {
    await open.close();
  }
}

/** Writes blocks into a page, one after another, after its last block. */
export async function writeBlocks(page: string, blocks: readonly NewBlock[]): Promise<void> {
  if (blocks.length === 0) return;
  const open = await pagesClient().open(page as PageId, { viewport: null });
  try {
    let after = [...open.initial.blocks].sort(byOrder).at(-1)?.id;
    const edits: Edit[] = blocks.map((block) => {
      const edit: Edit = after ? { edit: 'insertBlock', block, after } : { edit: 'insertBlock', block };
      after = block.id;
      return edit;
    });
    await open.send({ edits });
  } finally {
    await open.close();
  }
}

export function placeholders(title: string, now: Date = new Date()): Placeholders {
  const iso = now.toISOString();
  return { date: formatDate(iso), time: formatTime(iso), title };
}

/** Puts the caret where the template's {{cursor}} was, once the page has drawn that block. */
export async function placeCursor(cursor: TemplateCursor | null): Promise<void> {
  if (!cursor) return;
  for (let tries = 0; tries < 25; tries += 1) {
    const mounted = shownMounted.get();
    if (mounted?.layer.view(cursor.block)) {
      mounted.pool.mount(cursor.block, { kind: 'selection', anchor: cursor.pos, head: cursor.pos }, 'target');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Fills a page that was just made with a template's blocks. */
export async function fillFromTemplate(pageId: string, template: string, title: string): Promise<void> {
  const blocks = await readBlocks(template);
  const { blocks: made, cursor } = fromTemplate(blocks, placeholders(title));
  await writeBlocks(pageId, made);
  await placeCursor(cursor);
}

/** Inserts a template into the shown page, after the block with the caret, as one step. */
export async function insertTemplate(mounted: MountedPage, template: string, title: string): Promise<boolean> {
  if (mounted.page.readOnly) return false;
  const { blocks, cursor } = fromTemplate(await readBlocks(template), placeholders(title));
  if (blocks.length === 0) return false;
  await mounted.sync.flushAll('command');
  let after: string | null = currentBlock(mounted) ?? mounted.layer.blocks().at(-1)?.id ?? null;
  const edits: Edit[] = blocks.map((block) => {
    const edit: Edit = after ? { edit: 'insertBlock', block, after } : { edit: 'insertBlock', block };
    after = block.id;
    return edit;
  });
  const ack = await mounted.sync.send({ edits });
  const now = new Date().toISOString();
  for (const block of blocks) {
    mounted.layer.upsert({ ...block, order: ack.orderKeys[block.id] ?? 'zz', created: now, modified: now });
  }
  await placeCursor(cursor);
  return true;
}

/** What the next page created by "New page" should become. */
type Pending =
  | { kind: 'template'; template: string }
  | { kind: 'series'; source: string }
  /** A page made from text, such as the formula sheet. */
  | { kind: 'content'; title: string; blocks: NewBlock[] };
let pending: Pending | null = null;

/** Creates a page with the tree's own New page command, so it lands where New page puts it, then fills it. */
export async function newPageWith(request: Pending): Promise<void> {
  pending = request;
  try {
    await executeCommand('notes.newPage', undefined, 'menu');
  } finally {
    pending = null;
  }
}

/** Fills the page that "New page" just made: a chosen template, the next page of a series, or the section's default. */
export async function onPageCreated(pageId: NodeId, ctx: CommandContext): Promise<void> {
  const request = pending;
  pending = null;
  const node = await ctx.notes.get(pageId);
  if (request?.kind === 'series') return void (await continueSeries(pageId, request.source, ctx));
  if (request?.kind === 'content') {
    await ctx.notes.rename(pageId, request.title).catch(() => undefined);
    return void (await writeBlocks(pageId, request.blocks));
  }
  const template =
    request?.kind === 'template'
      ? request.template
      : (pageExtrasPrefs.get().templateDefaults[node?.parentId ?? ''] ?? null);
  if (!template || template === pageId) return;
  await fillFromTemplate(pageId, template, node?.title ?? '');
}

/** The next page of a series: named for the series and today, linked back to the last page, and linked from it. */
async function continueSeries(pageId: NodeId, source: string, ctx: CommandContext): Promise<void> {
  const last = await ctx.notes.get(source as NodeId);
  const base = seriesBase(last?.title ?? '') || t('pageExtras.series.untitled');
  const title = `${base} · ${dateTimeText('date')}`;
  await ctx.notes.rename(pageId, title).catch(() => undefined);
  const blocks = seriesBlocks(await readBlocks(source), {
    previous: last ? { title: last.title || base, page: source } : null,
    previousLabel: t('pageExtras.series.before'),
    carry: pageExtrasPrefs.get().seriesCarry,
  });
  await writeBlocks(pageId, blocks);
  await stampSeries(source, pageId).catch(() => undefined);
  const forward: NewBlock = {
    id: newId(),
    type: 'text',
    data: { markdown: `${t('pageExtras.series.next')} ${pageLink(title, pageId)}` },
  };
  await writeBlocks(source, [forward]).catch(() => undefined);
}

/** Tells the person there is nothing to pick yet. */
export function noTemplates(): void {
  showToast({ message: t('pageExtras.templates.none') });
  announce(t('pageExtras.templates.none'));
}

/** The series id of a page, or null when it belongs to none. */
export async function seriesOfPage(page: string): Promise<string | null> {
  const open = await pagesClient().open(page as PageId, { viewport: null });
  try {
    return seriesIdInView(open.initial.view);
  } finally {
    await open.close();
  }
}

/** Puts the new page in the series of the one it continues, giving that one a series first when it has none. */
async function stampSeries(source: string, page: string): Promise<void> {
  const id = (await seriesOfPage(source)) ?? newSeriesId();
  const client = pagesClient();
  await setSeries(client, source, id);
  await setSeries(client, page, id);
}
