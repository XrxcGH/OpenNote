// Note numbers (R-FN-6, ADR 0087). Numbers are never stored. Footnotes and endnotes each count from their own start
// in reading order across the page, in their own format. The settings live in the page's `view.text.notes`.
import { formatNumber } from '../paragraph/numberFormats';
import type { NoteJson, NoteKind, NoteMark } from './refs';

/** The number formats a note can use: the `ST_NumberFormat` names, so DOCX maps them one to one. */
export const NOTE_FORMATS = ['decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter', 'chicago'] as const;
export type NoteFormat = (typeof NOTE_FORMATS)[number];

/** Where numbering starts again: never, or at each level 1 heading. */
export const NOTE_RESTARTS = ['continuous', 'heading'] as const;
export type NoteRestart = (typeof NOTE_RESTARTS)[number];

export interface NoteSettings {
  format: NoteFormat;
  start: number;
  restart: NoteRestart;
}

export type NotesSettings = Record<NoteKind, NoteSettings>;

/** Word's and Docs' defaults: footnotes count in decimal and endnotes in lowercase Roman numerals. */
export const DEFAULT_NOTE_SETTINGS: NotesSettings = {
  foot: { format: 'decimal', start: 1, restart: 'continuous' },
  end: { format: 'lowerRoman', start: 1, restart: 'continuous' },
};

export const MAX_NOTE_START = 32_767;

/** The Chicago Manual of Style's note symbols. After the fourth, they double, then triple. */
const CHICAGO = ['*', '†', '‡', '§'];

/** A note's label for number `n` in `format`. */
export function noteLabel(n: number, format: NoteFormat): string {
  if (format !== 'chicago') return formatNumber(n, format);
  if (n < 1) return String(n);
  const symbol = CHICAGO[(n - 1) % CHICAGO.length]!;
  return symbol.repeat(Math.floor((n - 1) / CHICAGO.length) + 1);
}

function readOne(value: unknown, fallback: NoteSettings): NoteSettings {
  if (!value || typeof value !== 'object') return fallback;
  const record = value as Record<string, unknown>;
  const format = (NOTE_FORMATS as readonly unknown[]).includes(record.format)
    ? (record.format as NoteFormat)
    : fallback.format;
  const start =
    typeof record.start === 'number' && Number.isInteger(record.start) && record.start >= 0
      ? Math.min(record.start, MAX_NOTE_START)
      : fallback.start;
  const restart = (NOTE_RESTARTS as readonly unknown[]).includes(record.restart)
    ? (record.restart as NoteRestart)
    : fallback.restart;
  return { format, start, restart };
}

/** The note settings of a page's `view`. An invalid value reads as missing (R-VIEW-4). */
export function readNoteSettings(view: unknown): NotesSettings {
  const notes = (view as { text?: { notes?: Record<string, unknown> } } | null)?.text?.notes;
  return {
    foot: readOne(notes?.foot, DEFAULT_NOTE_SETTINGS.foot),
    end: readOne(notes?.end, DEFAULT_NOTE_SETTINGS.end),
  };
}

/** One text block as the numbering sees it. */
export interface NumberingBlock {
  id: string;
  marks: readonly NoteMark[];
  notes: Readonly<Record<string, NoteJson>>;
}

export interface NumberedNote {
  id: string;
  block: string;
  kind: NoteKind;
  n: number;
  label: string;
  /** The note's text, or null when the reference names no note (R-FN-5). */
  markdown: string | null;
}

export interface Numbering {
  /** Each referenced note by ID. */
  byId: ReadonlyMap<string, NumberedNote>;
  /** Footnotes, then endnotes, each in number order. */
  foot: readonly NumberedNote[];
  end: readonly NumberedNote[];
}

/**
 * Numbers the notes of `blocks`, which come in reading order. A note referred to twice keeps its first number. A
 * reference whose note is missing counts as a footnote, the default kind.
 */
export function numberNotes(blocks: readonly NumberingBlock[], settings: NotesSettings): Numbering {
  const byId = new Map<string, NumberedNote>();
  const lists: Record<NoteKind, NumberedNote[]> = { foot: [], end: [] };
  const next: Record<NoteKind, number> = { foot: settings.foot.start, end: settings.end.start };
  for (const block of blocks) {
    for (const mark of block.marks) {
      if (mark.kind === 'heading') {
        for (const kind of ['foot', 'end'] as const) {
          if (settings[kind].restart === 'heading') next[kind] = settings[kind].start;
        }
        continue;
      }
      if (byId.has(mark.id)) continue;
      const note = block.notes[mark.id] ?? null;
      const kind = note?.kind ?? 'foot';
      const n = next[kind]++;
      const numbered: NumberedNote = {
        id: mark.id,
        block: block.id,
        kind,
        n,
        label: noteLabel(n, settings[kind].format),
        markdown: note?.markdown ?? null,
      };
      byId.set(mark.id, numbered);
      lists[kind].push(numbered);
    }
  }
  return { byId, foot: lists.foot, end: lists.end };
}
