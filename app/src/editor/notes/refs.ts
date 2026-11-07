// Footnote references in a text block (SPEC 7.12, ADR 0087). A reference is the inline atom `footnoteRef`, written
// `[^ID]`. Its note lives in `data.notes` of the same block (R-NOTE-2). The page numbers references in reading order,
// so this file lists them in document order, with the level 1 headings in between for the "restart at each heading"
// rule.
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseTextBlock } from '../markdown';
import { isElementId } from '../schema/constants';

/** A note's record in `data.notes` (R-NOTE-1). */
export interface NoteJson {
  kind: NoteKind;
  markdown: string;
}

export type NoteKind = 'foot' | 'end';

/** What the numbering walks: a reference, or a level 1 heading where numbering may restart. */
export type NoteMark = { kind: 'ref'; id: string } | { kind: 'heading' };

/**
 * The references and level 1 headings of a text block's document, in document order. A reference whose ID is not a
 * valid element ID (D.9) is left out, so the page's number sheet never holds text that could break out of its rule.
 */
export function noteMarks(doc: PMNode): NoteMark[] {
  const out: NoteMark[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'footnoteRef') {
      const id = String(node.attrs.id);
      if (isElementId(id)) out.push({ kind: 'ref', id });
      return false;
    }
    if (node.type.name === 'heading' && node.attrs.level === 1) out.push({ kind: 'heading' });
    // Text and other leaves hold no references.
    return !node.isTextblock || node.childCount > 0;
  });
  return out;
}

/** The IDs a document refers to, each once, in document order. */
export function refIds(doc: PMNode): string[] {
  const seen = new Set<string>();
  for (const mark of noteMarks(doc)) if (mark.kind === 'ref') seen.add(mark.id);
  return [...seen];
}

/**
 * The IDs a block's Markdown refers to. The text has no `[^` at all in most blocks, which skips the parse. A `[^`
 * can still be literal text (escaped, or in code), so the parse decides.
 */
export function refIdsInMarkdown(markdown: string): string[] {
  if (!markdown.includes('[^')) return [];
  return refIds(parseTextBlock(markdown));
}

/** A valid note record from stored data, or null (R-NOTE-1: kind defaults to foot). */
export function readNote(value: unknown): NoteJson | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const markdown = typeof record.markdown === 'string' ? record.markdown : '';
  return { kind: record.kind === 'end' ? 'end' : 'foot', markdown };
}

/** A block's notes from its `data`, keeping only valid records. */
export function readNotes(data: unknown): Record<string, NoteJson> {
  const notes = (data as { notes?: unknown } | null)?.notes;
  const out: Record<string, NoteJson> = {};
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return out;
  for (const [id, value] of Object.entries(notes as Record<string, unknown>)) {
    const note = readNote(value);
    if (note) out[id] = note;
  }
  return out;
}
