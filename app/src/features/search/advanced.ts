// Advanced search: pages that are archived, the heading a match sits in, and where to look (a recording's transcript
// or a picture's description). The index answers the search; these steps narrow and explain what it found.
import type { HeadingRef, SearchHit, Snippet } from '../../services/search/types';
import type { NodeId, NotesService } from '../../services/notes/types';

/** Folds case and runs of spaces, so a heading and a snippet compare by their words. */
const fold = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The heading a match is in: a heading of the snippet's own block whose words the snippet shows. */
export function matchingHeading(headings: readonly HeadingRef[], snippet: Snippet | null): HeadingRef | null {
  if (!snippet) return null;
  const words = fold(snippet.text);
  return (
    headings.find((heading) => heading.block === snippet.block && heading.text !== '' && words.includes(fold(heading.text))) ??
    null
  );
}

/** Whether the page, or the section or notebook that holds it, is archived. */
export async function isArchived(notes: NotesService, page: string, known = new Map<string, boolean>()): Promise<boolean> {
  let id: NodeId | null | undefined = page as NodeId;
  const trail: string[] = [];
  let archived = false;
  while (id) {
    const cached = known.get(id);
    if (cached !== undefined) {
      archived = cached;
      break;
    }
    trail.push(id);
    const node = await notes.get(id).catch(() => null);
    if (!node) break;
    if (node.archived) {
      archived = true;
      break;
    }
    id = node.parentId;
  }
  for (const seen of trail) known.set(seen, archived);
  return archived;
}

/** The hits without those on archived pages, unless the person asked to include them. */
export async function withoutArchived(
  notes: NotesService,
  hits: readonly SearchHit[],
  include: boolean,
): Promise<SearchHit[]> {
  if (include) return [...hits];
  const known = new Map<string, boolean>();
  const kept: SearchHit[] = [];
  for (const hit of hits) if (!(await isArchived(notes, hit.page, known))) kept.push(hit);
  return kept;
}
