// "Link all" for unlinked mentions, with a preview. The plan lists every place a title appears without a link, each with
// the words around it. The person leaves out the ones that are not meant, and the rest are linked as one change set, one
// batch per page, so a single Undo puts every page back.
import type { PagesClient } from '../../../platform/types';
import type { SearchClient, UnlinkedMention } from '../../../services/search/types';
import type { PageChange } from '../changeSet';

/** One place that a title appears without a link. */
export interface MentionItem {
  id: string;
  source: string;
  sourceTitle: string;
  block: string;
  /** The place in the block's `findMentions` list. */
  index: number;
  before: string;
  text: string;
  after: string;
}

/** Reads each page and lists the places, in page order and then block order. */
export async function planLinkAll(
  pages: PagesClient,
  search: SearchClient,
  mentions: readonly UnlinkedMention[],
  title: string,
): Promise<MentionItem[]> {
  const items: MentionItem[] = [];
  for (const mention of mentions) {
    let open;
    try {
      open = await pages.open(mention.source, { viewport: null });
    } catch {
      continue;
    }
    try {
      for (const { block: id } of mention.blocks) {
        const block = open.initial.blocks.find((candidate) => candidate.id === id);
        const markdown = typeof block?.data.markdown === 'string' ? block.data.markdown : null;
        if (markdown === null) continue;
        const found = await search.findMentions(markdown, title);
        found.forEach((one, index) =>
          items.push({
            id: `${mention.source}:${id}:${index}`,
            source: mention.source,
            sourceTitle: mention.sourceTitle,
            block: id,
            index,
            before: one.before,
            text: one.text,
            after: one.after,
          }),
        );
      }
    } finally {
      await open.close();
    }
  }
  return items;
}

export interface Linked {
  count: number;
  pages: number;
  changes: PageChange[];
}

/** Links the chosen places. A page that cannot be written keeps its text, and the others go on. */
export async function applyLinkAll(
  pages: PagesClient,
  search: SearchClient,
  chosen: readonly MentionItem[],
  target: { page: string; title: string },
): Promise<Linked> {
  const done: Linked = { count: 0, pages: 0, changes: [] };
  const bySource = new Map<string, MentionItem[]>();
  for (const item of chosen) bySource.set(item.source, [...(bySource.get(item.source) ?? []), item]);
  for (const [source, list] of bySource) {
    try {
      const open = await pages.open(source, { viewport: null });
      try {
        const change: PageChange = { page: source, texts: [] };
        const edits = [];
        for (const block of new Set(list.map((item) => item.block))) {
          const current = open.initial.blocks.find((candidate) => candidate.id === block);
          const markdown = typeof current?.data.markdown === 'string' ? current.data.markdown : null;
          if (markdown === null) continue;
          const which = list.filter((item) => item.block === block).map((item) => item.index);
          const result = await search.linkMentions(markdown, target.title, target.page, which);
          if (!result || result.markdown === markdown) continue;
          done.count += result.count;
          edits.push({ edit: 'setText' as const, block, markdown: result.markdown });
          change.texts.push({ block, before: markdown, after: result.markdown });
        }
        if (edits.length > 0) {
          await open.send({ edits });
          done.pages += 1;
          done.changes.push(change);
        }
      } finally {
        await open.close();
      }
    } catch {
      // This page keeps its words.
    }
  }
  return done;
}
