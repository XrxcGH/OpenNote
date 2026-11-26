// A note's text (R-NOTE-1): inline OpenNote Markdown with hard breaks. The note editor holds a text block document,
// so each line of it becomes a line of the note, joined by hard breaks. A note never refers to another note
// (R-FN-4), so a reference pasted into one is left out.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { PARAGRAPH, serializeInline } from '../markdown';
import { parseNoteText } from '../markdown/parse';

/** A note is at most 64 KiB (R-NOTE-1). */
export const MAX_NOTE_BYTES = 64 * 1024;

/** The document the note editor shows for a note's Markdown. */
export function noteDoc(markdown: string): PMNode {
  return parseNoteText(markdown);
}

function withoutRefs(block: PMNode): PMNode {
  const kept: PMNode[] = [];
  block.forEach((child) => {
    if (child.type.name !== 'footnoteRef') kept.push(child);
  });
  return kept.length === block.childCount ? block : block.type.create(block.attrs, Fragment.from(kept), block.marks);
}

/** The note's Markdown for the note editor's document. */
export function noteMarkdown(doc: PMNode): string {
  const lines: string[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    lines.push(serializeInline(withoutRefs(node), PARAGRAPH));
    return false;
  });
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines.join('\\\n');
}

/** Whether a note's Markdown fits the 64 KiB limit. */
export function fitsNote(markdown: string): boolean {
  return new TextEncoder().encode(markdown).length <= MAX_NOTE_BYTES;
}
