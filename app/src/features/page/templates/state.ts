// What the shown page and this session know about templates, in a module light enough for start-up: which pages
// are templates (the tag, plus changes the search index may not have heard of yet).
import { shownMounted } from '../pagesApi';

/** The tag that makes a page a template. */
export const TEMPLATE_TAG = 'template';

/** Templates saved or removed in this session, which the search index may not know yet. */
const added = new Map<string, string>();
const removed = new Set<string>();

/** The tags of pages as this window last set them, over the tags they were opened with. */
export const tagsNow = new Map<string, string[]>();

export function markTemplate(id: string, title: string, on: boolean): void {
  if (on) {
    added.set(id, title);
    removed.delete(id);
  } else {
    added.delete(id);
    removed.add(id);
  }
}

export function isMarked(id: string, tags: readonly string[]): boolean {
  return added.has(id) || (tags.includes(TEMPLATE_TAG) && !removed.has(id));
}

export function sessionTemplates(): { added: ReadonlyMap<string, string>; removed: ReadonlySet<string> } {
  return { added, removed };
}

export function shownTags(): { id: string; tags: string[] } | null {
  const mounted = shownMounted.get();
  if (!mounted) return null;
  return { id: mounted.page.id, tags: tagsNow.get(mounted.page.id) ?? [...mounted.page.initial.tags] };
}

/** Whether the shown page is a template now. */
export function shownIsTemplate(): boolean {
  const shown = shownTags();
  return !!shown && isMarked(shown.id, shown.tags);
}
