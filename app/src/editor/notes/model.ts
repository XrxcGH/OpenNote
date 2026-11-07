// What a page view knows of its notes (R-NOTE-1, R-NOTE-2, ADR 0087): each text block's `data.notes` as the core
// has it, the page's note settings, and the notes whose references left a block.
//
// The text sync asks `rider` for edits to send in the same batch as a block's new Markdown, so one undo step holds
// both. A reference that leaves its block takes its note along. A reference that comes into a block brings its
// note back: a new reference from Insert footnote, or one that was cut, moved to another block, or deleted and then
// typed back. Writers drop notes that no reference names (R-NOTE-2), so the rider does that too.
import { refIdsInMarkdown } from './refs';
import type { NoteJson, NoteKind } from './refs';
import { DEFAULT_NOTE_SETTINGS, readNoteSettings } from './numbering';
import type { NotesSettings } from './numbering';

/** A merge patch of one block's notes: a note, part of a note, or null to remove it. */
export type NotesPatch = Record<string, Partial<NoteJson> | null>;

/** The `patchBlock` edit that changes a block's notes. It has the shape of the page service's `Edit`. */
export interface NotesEdit {
  edit: 'patchBlock';
  block: string;
  data: { notes: NotesPatch };
}

/** How many notes that left their blocks are kept for a paste or an undo in the editor. */
const KEEP_LEFT = 1000;

export class NotesModel {
  private readonly notes = new Map<string, Record<string, NoteJson>>();
  /** Notes whose references left their blocks, newest last, so a paste brings them back. */
  private readonly left = new Map<string, NoteJson>();
  /** Notes a command made for a reference it is about to insert. */
  private readonly pending = new Map<string, NoteJson>();
  private settingsNow: NotesSettings = DEFAULT_NOTE_SETTINGS;
  private readonly listeners = new Set<() => void>();

  /** The notes of a block, as the core has them. */
  of(block: string): Readonly<Record<string, NoteJson>> {
    return this.notes.get(block) ?? {};
  }

  /** The notes a block shows: its own, and those of references a command is inserting, until the core has them. */
  shown(block: string): Readonly<Record<string, NoteJson>> {
    const own = this.of(block);
    return this.pending.size === 0 ? own : { ...Object.fromEntries(this.pending), ...own };
  }

  /** The note with `id` in any block, and its block. */
  find(id: string): { block: string; note: NoteJson } | null {
    for (const [block, notes] of this.notes) if (notes[id]) return { block, note: notes[id] };
    return null;
  }

  blocks(): string[] {
    return [...this.notes.keys()];
  }

  settings(): NotesSettings {
    return this.settingsNow;
  }

  /** The core sent a block's data (the page as opened, an undo, another window): it is the truth. */
  setBlock(block: string, notes: Record<string, NoteJson>): void {
    if (Object.keys(notes).length === 0) this.notes.delete(block);
    else this.notes.set(block, { ...notes });
    this.changed();
  }

  /** The block left the page. Its notes stay known, so an undo in an editor or a paste can bring them back. */
  removeBlock(block: string): void {
    const notes = this.notes.get(block);
    if (!notes) return;
    for (const [id, note] of Object.entries(notes)) this.keepLeft(id, note);
    this.notes.delete(block);
    this.changed();
  }

  setView(view: unknown): void {
    this.settingsNow = readNoteSettings(view);
    this.changed();
  }

  /** A command is about to insert a reference to a new note. */
  expect(id: string, kind: NoteKind, markdown = ''): void {
    this.pending.set(id, { kind, markdown });
  }

  /** Applies a patch this window sends, so the model need not wait for the core. */
  apply(block: string, patch: NotesPatch): void {
    const notes = { ...(this.notes.get(block) ?? {}) };
    for (const [id, value] of Object.entries(patch)) {
      this.pending.delete(id);
      if (value === null) delete notes[id];
      else notes[id] = { ...(notes[id] ?? { kind: 'foot', markdown: '' }), ...value };
    }
    this.setBlock(block, notes);
  }

  /**
   * The note edits that go with a block's new Markdown, `before` to `after`, in the same batch. An empty list when
   * the block's notes already match its references.
   */
  rider(block: string, before: string, after: string): NotesEdit[] {
    const have = this.notes.get(block) ?? {};
    const ids = Object.keys(have);
    if (ids.length === 0 && !after.includes('[^') && this.pending.size === 0) return [];
    if (before === after && this.pending.size === 0) return [];
    const refs = new Set(refIdsInMarkdown(after));
    const patch: NotesPatch = {};
    for (const id of ids) {
      if (refs.has(id)) continue;
      patch[id] = null;
      this.keepLeft(id, have[id]!);
    }
    for (const id of refs) {
      if (have[id]) continue;
      const note = this.pending.get(id) ?? this.left.get(id) ?? this.elsewhere(block, id);
      if (!note) continue;
      patch[id] = note;
      this.pending.delete(id);
      this.left.delete(id);
    }
    if (Object.keys(patch).length === 0) return [];
    this.apply(block, patch);
    return [{ edit: 'patchBlock', block, data: { notes: patch } }];
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** A copy of a note another block still holds, for a reference that was copied rather than moved. */
  private elsewhere(block: string, id: string): NoteJson | null {
    for (const [other, notes] of this.notes) if (other !== block && notes[id]) return { ...notes[id] };
    return null;
  }

  private keepLeft(id: string, note: NoteJson): void {
    this.left.delete(id);
    this.left.set(id, note);
    if (this.left.size > KEEP_LEFT) this.left.delete(this.left.keys().next().value!);
  }

  private changed(): void {
    this.listeners.forEach((listener) => listener());
  }
}
