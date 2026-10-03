// "Link" and "Link all" for the pages that say a title without linking it: reads the Markdown of the blocks the
// index points at, turns the mentions into links, and writes each page as one batch, so one undo undoes it.
import type { PagesClient } from '../../../platform/types';
import type { SearchClient, UnlinkedMention } from '../../../services/search/types';

/** Links every mention of `title` on one page to `target`. Returns how many it linked. */
export async function linkMentionsOnPage(
  pages: PagesClient,
  search: SearchClient,
  mention: UnlinkedMention,
  target: { page: string; title: string },
): Promise<number> {
  const open = await pages.open(mention.source, { viewport: null });
  try {
    let linked = 0;
    const edits = [];
    for (const { block: id } of mention.blocks) {
      const block = open.initial.blocks.find((candidate) => candidate.id === id);
      const markdown = typeof block?.data.markdown === 'string' ? block.data.markdown : null;
      if (markdown === null) continue;
      const result = await search.linkMentions(markdown, target.title, target.page);
      if (!result || result.markdown === markdown) continue;
      linked += result.count;
      edits.push({ edit: 'setText' as const, block: id, markdown: result.markdown });
    }
    if (edits.length) await open.send({ edits });
    return linked;
  } finally {
    await open.close();
  }
}
