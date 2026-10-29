// Flags: marks the person drops on a recording to find a moment again. A flag sits at a capture time, so it keeps its
// place when the audio is trimmed or split, and it carries an optional short label. The list is kept in the recording
// entry's `flags` field, which the note format treats as an extra field and keeps untouched. An edit keeps the
// recording's ID, so its flags stay with it. A split makes a second recording, and `moveToSplit` hands it its flags.

import { halfAt } from './stamps';
import type { SplitHalf } from './stamps';
import type { RecordingEntry, StampEntry } from './types';

/** The longest label a flag keeps, in UTF-16 code units. A flag names a moment, and does not hold notes. */
export const MAX_LABEL_LENGTH = 80;

export interface Flag {
  id: string;
  recording: string;
  captureNs: number;
  label: string;
}

function cleanLabel(label: string): string {
  return label.trim().slice(0, MAX_LABEL_LENGTH);
}

function isFlag(value: unknown): value is Flag {
  if (typeof value !== 'object' || value === null) return false;
  const flag = value as Record<string, unknown>;
  return (
    typeof flag['id'] === 'string' &&
    typeof flag['recording'] === 'string' &&
    typeof flag['captureNs'] === 'number' &&
    typeof flag['label'] === 'string'
  );
}

function byTime(a: Flag, b: Flag): number {
  return a.captureNs - b.captureNs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The flags of a page, in time order. Changing them gives back whether anything changed. */
export class Flags {
  private flags: Flag[];

  constructor(flags: readonly Flag[] = []) {
    this.flags = [...flags].sort(byTime);
  }

  /**
   * The flags in a page's recording entries. Damaged items are left out, and the rest are kept. A flag belongs to
   * the entry that stores it. One that names another recording, as after an edit that gave the recording a new ID,
   * is moved to that entry instead of being lost.
   */
  static fromEntries(entries: readonly RecordingEntry[]): Flags {
    const found: Flag[] = [];
    for (const entry of entries) {
      const stored = entry['flags'];
      if (!Array.isArray(stored)) continue;
      for (const item of stored) if (isFlag(item)) found.push({ ...item, recording: entry.id });
    }
    return new Flags(found);
  }

  get size(): number {
    return this.flags.length;
  }

  /** The flags of one recording, or all of them, in time order. */
  list(recording?: string): readonly Flag[] {
    return recording === undefined ? this.flags : this.flags.filter((flag) => flag.recording === recording);
  }

  get(id: string): Flag | undefined {
    return this.flags.find((flag) => flag.id === id);
  }

  /** Drops a flag at a moment. A second flag on the very same instant is a double press, so it returns the first. */
  add(recording: string, captureNs: number, newId: () => string, label = ''): Flag {
    const twin = this.flags.find((flag) => flag.recording === recording && flag.captureNs === captureNs);
    if (twin) return twin;
    const flag = { id: newId(), recording, captureNs, label: cleanLabel(label) };
    this.flags = [...this.flags, flag].sort(byTime);
    return flag;
  }

  rename(id: string, label: string): boolean {
    const index = this.flags.findIndex((flag) => flag.id === id);
    const current = this.flags[index];
    if (!current || current.label === cleanLabel(label)) return false;
    this.flags = this.flags.map((flag) => (flag.id === id ? { ...flag, label: cleanLabel(label) } : flag));
    return true;
  }

  remove(id: string): boolean {
    const before = this.flags.length;
    this.flags = this.flags.filter((flag) => flag.id !== id);
    return this.flags.length !== before;
  }

  /**
   * After a split of the recording `from`, gives each flag of it to the half whose capture times hold it. Save
   * each half's entry through `into` afterwards. Returns whether any flag moved.
   */
  moveToSplit(from: string, halves: readonly SplitHalf[]): boolean {
    let moved = false;
    this.flags = this.flags.map((flag) => {
      const half = flag.recording === from ? halfAt(halves, flag.captureNs) : undefined;
      if (!half || half.id === from) return flag;
      moved = true;
      return { ...flag, recording: half.id };
    });
    return moved;
  }

  /** The recording entry with its flags replaced by these. Everything else in the entry stays. */
  into(entry: RecordingEntry): RecordingEntry {
    const mine = this.list(entry.id);
    const { flags: _old, ...rest } = entry;
    return mine.length > 0 ? { ...rest, flags: mine.map((flag) => ({ ...flag })) } : rest;
  }

  /** The entries for the stamp index, where a flag starts and ends at one instant. */
  stampEntries(): StampEntry[] {
    return this.flags.map((flag) => ({
      recording: flag.recording,
      startNs: flag.captureNs,
      endNs: flag.captureNs,
      target: { type: 'flag', id: flag.id },
    }));
  }
}
