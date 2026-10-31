// The notes an exam is made from (ADR 0052): selected pages, a section, or a whole notebook. Each page's text blocks
// are read through the page service and kept apart, so every question remembers its page. Protected pages are left
// out (ADR 0042), and so is the "Practice exams" section, so an exam is never made from an earlier exam.
import type { NodeId, NodeSummary, NotesService } from '../../../services/notes';
import type { PageService } from '../../../services/pages/types';
import { pageText } from '../deck/sectionText';

export interface ExamSource {
  pageId: string;
  title: string;
  /** The page's text blocks as Markdown. */
  text: string;
}

export interface Gathered {
  sources: ExamSource[];
  /** Pages that could not be read or are protected. */
  skipped: number;
}

/** The most pages one exam reads, and the most characters of notes in all. */
export const MAX_PAGES = 60;
export const MAX_CHARS = 200_000;
/** Section groups inside section groups: deeper than this is not searched. */
const MAX_DEPTH = 6;

/** The pages under a section, section group, or notebook, in order, leaving out sections with the given title. */
export async function pagesUnder(
  notes: Pick<NotesService, 'listChildren'>,
  root: NodeId,
  skipSection: string,
  depth = 0,
): Promise<NodeSummary[]> {
  if (depth > MAX_DEPTH) return [];
  const found: NodeSummary[] = [];
  for (const child of await notes.listChildren(root)) {
    if (found.length >= MAX_PAGES) break;
    if (child.kind === 'page') found.push(child);
    else if (child.kind === 'section' && child.title === skipSection) continue;
    else if (child.kind === 'section' || child.kind === 'sectionGroup')
      found.push(...(await pagesUnder(notes, child.id, skipSection, depth + 1)));
  }
  return found.slice(0, MAX_PAGES);
}

/** Reads each page's text, one at a time, closing each when done. */
export async function readPages(
  pages: Pick<PageService, 'open'>,
  list: readonly Pick<NodeSummary, 'id' | 'title'>[],
  isProtected: (id: string) => boolean,
): Promise<Gathered> {
  const sources: ExamSource[] = [];
  let skipped = 0;
  let chars = 0;
  for (const node of list.slice(0, MAX_PAGES)) {
    if (isProtected(node.id)) {
      skipped += 1;
      continue;
    }
    try {
      const open = await pages.open(node.id, { viewport: null });
      try {
        const text = pageText(open.initial).slice(0, Math.max(0, MAX_CHARS - chars));
        chars += text.length;
        if (text.trim()) sources.push({ pageId: node.id, title: open.initial.title || node.title, text });
      } finally {
        await open.close().catch(() => undefined);
      }
    } catch {
      skipped += 1;
    }
    if (chars >= MAX_CHARS) break;
  }
  return { sources, skipped };
}
