// What Extract, Merge, and Split do. They make new pages through the notes service and fill them through the page
// service, and they leave the pages they read as they were; Extract is the one that changes the page it is on,
// replacing the extracted text with a link to the new page. They load when a command first runs.
import { commandContext } from '../../../commands/registry';
import { fromChange, runCommand } from '../../../editor/commands/command';
import { newId } from '../../../editor/ids';
import { createMarkdownCache, serializeTextBlock } from '../../../editor/markdown';
import type { NodeId, NodeSummary, NotesService, PageLevel } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { targetEditor } from '../formattingBar/target';
import { shownMounted } from '../pagesApi';
import { readBlocks, writeBlocks } from '../templates/apply';
import { pickPages } from './MergeDialog';
import { extractTitle, mergeBlocks, splitAtHeadings } from './sections';

interface Place {
  parentId: NodeId | null;
  beforeId: NodeId | null;
  level: PageLevel;
}

/** Just after a page and its subpages, one level deeper (subpages go no deeper than two levels). */
async function placeAfter(notes: NotesService, page: NodeSummary, deeper: boolean): Promise<Place> {
  const list = page.parentId ? await notes.listChildren(page.parentId) : [];
  let at = list.findIndex((node) => node.id === page.id) + 1;
  while (at > 0 && at < list.length && list[at].pageLevel > page.pageLevel) at += 1;
  const level = Math.min(2, page.pageLevel + (deeper ? 1 : 0)) as PageLevel;
  return { parentId: page.parentId, beforeId: list[at]?.id ?? null, level };
}

const createPage = (notes: NotesService, place: Place, title: string) =>
  notes.create({
    kind: 'page',
    placement: { parentId: place.parentId, beforeId: place.beforeId },
    title,
    pageLevel: place.level,
  });

async function shownPageNode(notes: NotesService): Promise<NodeSummary | null> {
  const mounted = shownMounted.get();
  return mounted ? notes.get(mounted.page.id as NodeId) : null;
}

/** Moves the selected text into a new subpage and leaves a link to it where the text was. */
export async function extractSelection(): Promise<void> {
  const editor = targetEditor();
  const mounted = shownMounted.get();
  if (!editor || !mounted || mounted.page.readOnly) return;
  if (editor.state.selection.empty) return announce(t('pageExtras.extract.nothingSelected'));
  const { notes } = commandContext('menu');
  const page = await shownPageNode(notes);
  const slice = editor.state.selection.content();
  const doc = editor.schema.topNodeType.createAndFill(null, slice.content);
  if (!page || !doc) return;
  const markdown = serializeTextBlock(doc, createMarkdownCache());
  const title = extractTitle(markdown, t('pageExtras.extract.untitled'));
  const created = await createPage(notes, await placeAfter(notes, page, true), title);
  await writeBlocks(created.id, [{ id: newId(), type: 'text', data: { markdown } }]);
  const link = editor.schema.marks.link?.create({ href: `opennote:page/${created.id}` });
  if (!link || editor.isDestroyed) return;
  runCommand(
    editor,
    fromChange((tr) => {
      tr.deleteSelection();
      tr.insert(tr.selection.from, editor.schema.text(title, [link]));
      return true;
    }),
  );
  announce(t('pageExtras.extract.done', { title }));
}

/** Makes one new page from the pages the person picks from the current section, titles as headings. */
export async function mergePages(): Promise<void> {
  const { notes } = commandContext('menu');
  const page = await shownPageNode(notes);
  if (!page?.parentId) return;
  const siblings = (await notes.listChildren(page.parentId)).filter((node) => node.kind === 'page');
  const chosen = await pickPages(siblings, page.id);
  if (!chosen || chosen.length < 2) return;
  await shownMounted.get()?.sync.flushAll('command');
  const ordered = siblings.filter((node) => chosen.includes(node.id));
  const pages = await Promise.all(
    ordered.map(async (node) => ({ title: node.title, blocks: await readBlocks(node.id) })),
  );
  const last = ordered[ordered.length - 1];
  const title = t('pageExtras.merge.title', { first: ordered[0].title, count: ordered.length - 1 });
  const created = await createPage(notes, await placeAfter(notes, last, false), title);
  await writeBlocks(created.id, mergeBlocks(pages));
  showToast({ message: t('pageExtras.merge.done', { count: ordered.length }) });
}

/** Makes one subpage for each heading of the least level on the page. */
export async function splitPage(): Promise<void> {
  const mounted = shownMounted.get();
  if (!mounted) return;
  const { notes } = commandContext('menu');
  const page = await shownPageNode(notes);
  if (!page) return;
  await mounted.sync.flushAll('command');
  const result = splitAtHeadings(await readBlocks(mounted.page.id));
  if (!result || result.sections.length === 0) return announce(t('pageExtras.split.none'));
  const place = await placeAfter(notes, page, true);
  let count = 0;
  for (const section of result.sections) {
    const title = section.title || t('pageExtras.split.untitled');
    const created = await createPage(notes, place, title);
    await writeBlocks(created.id, section.blocks);
    count += 1;
  }
  showToast({
    message:
      result.skipped > 0
        ? t('pageExtras.split.doneSkipped', { count, skipped: result.skipped })
        : t('pageExtras.split.done', { count }),
  });
}
