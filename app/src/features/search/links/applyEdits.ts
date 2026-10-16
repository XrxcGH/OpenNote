// Applies link edits to pages as ordinary edits: a rename rewrites the links that named the old title, and
// "Link" turns a mention into a link. Each page gets one batch, so one undo brings its links back.
import type { PagesClient } from '../../../platform/types';
import { parseLinks } from '../../../services/search/text';
import type { LinkEdit } from '../../../services/search/types';

/** The block's Markdown with the edit applied to the links that read exactly `edit.old`, never to code. */
export function applyEdit(markdown: string, edit: Pick<LinkEdit, 'old' | 'new'>): string {
  if (!edit.old.startsWith('[[')) return markdown.split(edit.old).join(edit.new);
  let out = markdown;
  for (const link of parseLinks(markdown).reverse()) {
    if (link.raw === edit.old) out = out.slice(0, link.start) + edit.new + out.slice(link.end);
  }
  return out;
}

export interface AppliedEdits {
  pages: number;
  links: number;
}

/**
 * Applies the edits page by page. A page that can't be opened or written is skipped, and the rest go on. Returns
 * how many pages and links changed.
 */
export async function applyLinkEdits(pages: PagesClient, edits: readonly LinkEdit[]): Promise<AppliedEdits> {
  const byPage = new Map<string, LinkEdit[]>();
  for (const edit of edits) byPage.set(edit.page, [...(byPage.get(edit.page) ?? []), edit]);
  const applied: AppliedEdits = { pages: 0, links: 0 };
  for (const [pageId, list] of byPage) {
    try {
      const open = await pages.open(pageId, { viewport: null });
      try {
        const markdown = new Map(
          open.initial.blocks.map((block) => [
            block.id,
            typeof block.data.markdown === 'string' ? block.data.markdown : '',
          ]),
        );
        const batch = [];
        for (const edit of list) {
          const before = markdown.get(edit.block);
          if (before === undefined) continue;
          const after = applyEdit(before, edit);
          if (after === before) continue;
          markdown.set(edit.block, after);
          applied.links += 1;
        }
        for (const edit of new Set(list.map((e) => e.block))) {
          const current = open.initial.blocks.find((block) => block.id === edit);
          const after = markdown.get(edit);
          if (current && after !== undefined && after !== current.data.markdown) {
            batch.push({ edit: 'setText' as const, block: edit, markdown: after });
          }
        }
        if (batch.length) {
          await open.send({ edits: batch });
          applied.pages += 1;
        }
      } finally {
        await open.close();
      }
    } catch {
      // This page keeps its old links. The ones on other pages are still rewritten.
    }
  }
  return applied;
}
