// What Extract, Merge, and Split do. They make new pages through the notes service and fill them through the page
// service. They leave the pages they read as they were, except that Extract replaces the extracted text with a link
// to the new page. They load when a command first runs.
import { isEnabled } from '../../../app/flags';
import { commandContext } from '../../../commands/registry';
import { fromChange, runCommand } from '../../../editor/commands/command';
import { newId } from '../../../editor/ids';
import { createMarkdownCache, serializeTextBlock } from '../../../editor/markdown';
import { t } from '../../../strings/t';
import type { NodeId } from '../../../services/notes/types';
import { announce } from '../../../ui';
import { targetEditor } from '../formattingBar/target';
import { shownMounted } from '../pagesApi';
import { readBlocks, writeBlocks } from '../templates/apply';
import { shownPool } from '../pool/shown';
import { undoPageChanges } from '../../search';
import { finishChange } from './changes';
import { pagesClient } from '../runtime';
import { pickPages } from './MergeDialog';
import { createPage, placeAfter, shownPageNode } from './place';
import { extractTitle, mergeBlocks, splitAtHeadings } from './sections';

/** Moves the selected text into a new subpage and leaves a link to it where the text was. */
export async function extractSelection(): Promise<void> {
  const objects = await import('./objects');
  if (isEnabled('page.extractObjects') && objects.hasObjectSelection()) return objects.extractObjects();
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
  const block = shownPool.get()?.active()?.block ?? null;
  const before = serializeTextBlock(editor.state.doc, createMarkdownCache());
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
  const after = editor.isDestroyed ? before : serializeTextBlock(editor.state.doc, createMarkdownCache());
  const sourceId = mounted.page.id;
  const message = t('pageExtras.extract.done', { title });
  announce(message);
  finishChange(notes, {
    created: [created.id],
    revert:
      block && after !== before
        ? async () =>
            void (await undoPageChanges(pagesClient(), [{ page: sourceId, texts: [{ block, before, after }] }]))
        : null,
    message,
    history: { pages: [sourceId], name: t('pageExtras.history.extract', { title }) },
  });
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
  finishChange(notes, {
    created: [created.id],
    revert: null,
    message: t('pageExtras.merge.done', { count: ordered.length }),
    history: { pages: [created.id], name: t('pageExtras.history.merge', { count: ordered.length }) },
  });
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
  const made: NodeId[] = [];
  for (const section of result.sections) {
    const title = section.title || t('pageExtras.split.untitled');
    const created = await createPage(notes, place, title);
    await writeBlocks(created.id, section.blocks);
    made.push(created.id);
  }
  const count = made.length;
  finishChange(notes, {
    created: made,
    revert: null,
    message:
      result.skipped > 0
        ? `${t('pageExtras.split.done', { count })} ${t('pageExtras.split.skipped', { skipped: result.skipped })}`
        : t('pageExtras.split.done', { count }),
    history: { pages: [mounted.page.id], name: t('pageExtras.history.split', { count }) },
  });
}
