// Tags over the in-memory index: the tree of nested tags, and what renaming, merging, or deleting one would change.
import type { PageId, TagChange, TagNode, TagPlan } from '../types';
import { allDocs } from './docs';
import type { Index } from './docs';
import { normalTag } from './terms';

/** The pages that carry each tag exactly, by tag in normal form. */
function pagesByTag(index: Index): Map<string, Set<PageId>> {
  const own = new Map<string, Set<PageId>>();
  for (const doc of allDocs(index)) {
    for (const tag of doc.tags.map(normalTag).filter(Boolean)) {
      own.set(tag, (own.get(tag) ?? new Set()).add(doc.page));
    }
  }
  return own;
}

export function tagTree(index: Index): TagNode[] {
  const own = pagesByTag(index);
  const all = new Map<string, Set<PageId>>();
  for (const [tag, pages] of own) {
    const parts = tag.split('/');
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const name = parts.slice(0, depth).join('/');
      const set = all.get(name) ?? new Set<PageId>();
      pages.forEach((page) => set.add(page));
      all.set(name, set);
    }
  }
  return [...all]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, pages]) => ({ tag, pages: pages.size, ownPages: own.get(tag)?.size ?? 0 }));
}

/** What changing `from` to `to` does, or deleting it when `to` is null. Tags nested in `from` go with it. */
export function planTag(index: Index, from: string, to: string | null): TagPlan {
  const source = normalTag(from);
  const target = to === null ? null : normalTag(to);
  if (!source || (target !== null && (target === '' || target === source))) {
    return { changes: [], pageCount: 0, merges: false };
  }
  const own = pagesByTag(index);
  const changes: TagChange[] = [...own]
    .filter(([tag]) => tag === source || tag.startsWith(`${source}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, pages]) => ({
      from: tag,
      to: target === null ? null : `${target}${tag.slice(source.length)}`,
      pages: [...pages].sort(),
    }));
  const merges = changes.some((change) => change.to !== null && own.has(change.to));
  return { changes, pageCount: new Set(changes.flatMap((change) => change.pages)).size, merges };
}
