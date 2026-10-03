// Renaming a tag means rewriting the `#tag` words in the pages that carry it. The index plans the change (which
// tags, which pages); this reads each page and rewrites its text blocks, one batch per page, one undo.
import type { PagesClient } from '../../../platform/types';
import type { Edit } from '../../../services/pages/types';
import { fold } from '../../../services/search/text';
import type { TagPlan } from '../../../services/search/types';

/** The normal form of a tag: no `#`, folded, no empty parts. The same rules as crates/search. */
export function normalTag(tag: string): string {
  return fold(tag.trim().replace(/^#/, ''))
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

const TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;

/** The Markdown with each `#tag` that the plan changes rewritten. Code spans keep their text. */
export function rewriteTags(markdown: string, plan: Pick<TagPlan, 'changes'>): string {
  const map = new Map(plan.changes.map((change) => [change.from, change.to]));
  return markdown
    .split(/(`+[^`]*`+)/)
    .map((part, at) =>
      at % 2 === 1
        ? part
        : part.replace(TAG, (all, lead: string, tag: string) => {
            const changed = map.get(normalTag(tag));
            if (changed === undefined) return all;
            // A deleted tag leaves its words, without the hash, so the sentence still reads.
            return changed === null ? `${lead}${tag}` : `${lead}#${changed}`;
          }),
    )
    .join('');
}

export interface Rewritten {
  pages: number;
  tags: number;
}

/** A page's own tags after the plan: renamed, merged (a tag listed once), or removed. */
export function rewritePageTags(tags: readonly string[], plan: Pick<TagPlan, 'changes'>): string[] {
  const map = new Map(plan.changes.map((change) => [change.from, change.to]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const changed = map.get(normalTag(tag));
    const next = changed === undefined ? tag : changed;
    if (next === null || seen.has(normalTag(next))) continue;
    seen.add(normalTag(next));
    out.push(next);
  }
  return out;
}

/** Adds a tag to a page's own tags. A tag the page has already is not added again. */
export async function addTagToPage(pages: PagesClient, pageId: string, tag: string): Promise<boolean> {
  const wanted = normalTag(tag);
  if (!wanted) return false;
  const open = await pages.open(pageId, { viewport: null });
  try {
    if (open.initial.tags.some((existing) => normalTag(existing) === wanted)) return false;
    await open.send({ edits: [{ edit: 'setPage', tags: [...open.initial.tags, wanted] }] });
    return true;
  } finally {
    await open.close();
  }
}

/**
 * Applies a tag plan to its pages: their own tags, and any `#tag` written in their text. A page that can't be
 * written is skipped; the others go on. One batch per page, so one undo.
 */
export async function applyTagPlan(pages: PagesClient, plan: TagPlan): Promise<Rewritten> {
  const affected = [...new Set(plan.changes.flatMap((change) => change.pages))];
  const done: Rewritten = { pages: 0, tags: 0 };
  for (const pageId of affected) {
    try {
      const open = await pages.open(pageId, { viewport: null });
      try {
        const edits: Edit[] = [];
        const tags = rewritePageTags(open.initial.tags, plan);
        if (tags.join('\n') !== open.initial.tags.join('\n')) edits.push({ edit: 'setPage', tags });
        for (const block of open.initial.blocks) {
          if (block.type !== 'text' || typeof block.data.markdown !== 'string') continue;
          const after = rewriteTags(block.data.markdown, plan);
          if (after !== block.data.markdown) edits.push({ edit: 'setText', block: block.id, markdown: after });
        }
        if (edits.length) {
          await open.send({ edits });
          done.pages += 1;
          done.tags += edits.length;
        }
      } finally {
        await open.close();
      }
    } catch {
      // This page keeps its tags; the plan still holds for the rest.
    }
  }
  return done;
}
