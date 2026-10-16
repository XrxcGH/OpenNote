// The words of a section, for making cards from it: the text blocks of each of its pages, one page after another.
// A page that cannot be opened (a locked section's page, one another tool is writing) is left out, so a locked
// section gives no words at all.
import type { NodeSummary, NotesService } from '../../../services/notes';
import type { PageJson, PageService } from '../../../services/pages/types';

/** The Markdown of a page's text blocks, joined by blank lines. */
export function pageText(page: Pick<PageJson, 'blocks'>): string {
  return page.blocks
    .filter((block) => block.type === 'text')
    .map((block) => String(block.data.markdown ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

export interface SectionWords {
  /** The words of all the pages that could be read. */
  text: string;
  /** How many pages were read, and how many could not be. */
  read: number;
  skipped: number;
}

/** Reads the pages of a section through the page service, one at a time, closing each when done. */
export async function sectionText(
  notes: Pick<NotesService, 'listChildren'>,
  pages: Pick<PageService, 'open'>,
  section: Pick<NodeSummary, 'id'>,
): Promise<SectionWords> {
  const children = await notes.listChildren(section.id);
  const parts: string[] = [];
  let read = 0;
  let skipped = 0;
  for (const child of children) {
    if (child.kind !== 'page') continue;
    try {
      const open = await pages.open(child.id, { viewport: null });
      try {
        const text = pageText(open.initial);
        if (text) parts.push(text);
        read += 1;
      } finally {
        await open.close().catch(() => undefined);
      }
    } catch {
      skipped += 1;
    }
  }
  return { text: parts.join('\n\n'), read, skipped };
}
