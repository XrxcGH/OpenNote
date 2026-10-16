// The timestamp map: how everything written during a recording links back to its audio. The TypeScript twin of
// crates/media/src/stamps, and both pass the cases in crates/media/tests/fixtures (text-marks.json and
// stamp-index.json).
//
// Handwriting needs no new data, since every stroke stores its start time. The recording's clock anchor turns that
// Unix time into a capture time, and the position map turns the capture time into a place in the audio. Text has no
// times of its own, so a block keeps TextMarks, which say when each stretch of it was typed.

import { partitionPoint } from './positions';
import type { PositionMap } from './positions';
import type { StampEntry, Target, TextMark, TextMarksData } from './types';

/** Typing after this long a pause starts a new mark. */
export const MERGE_GAP_NS = 1_000_000_000;
/** A mark never spans more than this, so spreading time evenly over it stays honest. */
export const MERGE_SPAN_NS = 3_000_000_000;

/** A recording that a split made, and the capture times it covers. A `RecordingEntry` is one. */
export interface SplitHalf {
  id: string;
  startedNs: number;
  endedNs: number;
}

/** The half of a split that holds `captureNs`: the last one that starts at or before it, or else the first. */
export function halfAt(halves: readonly SplitHalf[], captureNs: number): SplitHalf | undefined {
  const sorted = [...halves].sort((a, b) => a.startedNs - b.startedNs);
  return sorted.findLast((half) => half.startedNs <= captureNs) ?? sorted[0];
}

/** When and in which recording an edit happened. */
export interface Stamp {
  recording: string;
  captureNs: number;
}

/** When the character `index` places into the mark was typed: the mark's times spread evenly over its characters. */
function charTime(mark: TextMark, index: number): number {
  const last = Math.max(mark.to - mark.from - 1, 0);
  if (last === 0 || mark.endNs <= mark.startNs) return mark.startNs;
  return mark.startNs + Math.floor(((mark.endNs - mark.startNs) * Math.min(index, last)) / last);
}

/** The part of a mark before `offset`, if any. */
function before(mark: TextMark, offset: number): TextMark | null {
  if (offset <= mark.from) return null;
  const to = Math.min(offset, mark.to);
  return { ...mark, to, endNs: charTime(mark, to - mark.from - 1) };
}

/** The part of a mark from `offset` on, if any, moved to start at `newFrom`. */
function after(mark: TextMark, offset: number, newFrom: number): TextMark | null {
  if (offset >= mark.to) return null;
  const start = Math.max(offset, mark.from);
  return { ...mark, from: newFrom, to: newFrom + (mark.to - start), startNs: charTime(mark, start - mark.from) };
}

function present(...marks: (TextMark | null)[]): TextMark[] {
  return marks.filter((mark): mark is TextMark => mark !== null);
}

/** The marks of one block of text. Offsets are UTF-16 code units, which is what the editor counts. */
export class TextMarks {
  recordings: string[];
  marks: TextMark[];

  constructor(data?: TextMarksData) {
    this.recordings = data ? [...data.recordings] : [];
    this.marks = data ? data.marks.map((mark) => ({ ...mark })) : [];
  }

  toData(): TextMarksData {
    return { recordings: [...this.recordings], marks: this.marks.map((mark) => ({ ...mark })) };
  }

  /**
   * Applies an edit to the text: `deleted` code units at `at` were replaced by `inserted` new ones. Marks move and
   * shrink with the text. With a stamp, the new text gets a mark.
   */
  edit(at: number, deleted: number, inserted: number, stamp?: Stamp): void {
    if (deleted > 0) this.remove(at, deleted);
    if (inserted > 0) {
      this.open(at, inserted);
      if (stamp) this.add(at, inserted, stamp);
    }
  }

  private remove(at: number, length: number): void {
    const end = at + length;
    this.marks = this.marks.flatMap((mark) => {
      if (mark.to <= at) return [mark];
      if (mark.from >= end) return [{ ...mark, from: mark.from - length, to: mark.to - length }];
      return present(before(mark, at), after(mark, end, at));
    });
  }

  private open(at: number, length: number): void {
    this.marks = this.marks.flatMap((mark) => {
      if (mark.to <= at) return [mark];
      if (mark.from >= at) return [{ ...mark, from: mark.from + length, to: mark.to + length }];
      return present(before(mark, at), after(mark, at, at + length));
    });
  }

  /** Marks the new text as typed at the stamp's time, extending the mark before it when it follows closely. */
  private add(at: number, length: number, stamp: Stamp): void {
    const recording = this.recordingIndex(stamp.recording);
    const index = partitionPoint(this.marks, (mark) => mark.from < at);
    const previous = index > 0 ? this.marks[index - 1] : undefined;
    if (
      previous &&
      previous.to === at &&
      previous.recording === recording &&
      stamp.captureNs >= previous.endNs &&
      stamp.captureNs - previous.endNs <= MERGE_GAP_NS &&
      stamp.captureNs - previous.startNs <= MERGE_SPAN_NS
    ) {
      previous.to = at + length;
      previous.endNs = stamp.captureNs;
      return;
    }
    this.marks.splice(index, 0, {
      from: at,
      to: at + length,
      recording,
      startNs: stamp.captureNs,
      endNs: stamp.captureNs,
    });
  }

  private recordingIndex(id: string): number {
    let index = this.recordings.indexOf(id);
    if (index < 0) {
      this.recordings.push(id);
      index = this.recordings.length - 1;
    }
    return Math.min(index, 0xffff);
  }

  /** The mark that holds the character at `offset`. */
  markAt(offset: number): TextMark | undefined {
    const mark = this.marks[partitionPoint(this.marks, (candidate) => candidate.to <= offset)];
    return mark && mark.from <= offset ? mark : undefined;
  }

  /** The recording and capture time of the character at `offset`. */
  timeAt(offset: number): { recording: string; captureNs: number } | null {
    const mark = this.markAt(offset);
    const recording = mark ? this.recordings[mark.recording] : undefined;
    if (!mark || recording === undefined) return null;
    return { recording, captureNs: charTime(mark, offset - mark.from) };
  }

  /** The marks of `recording` being typed at `captureNs` or in the `tailNs` before it, for a moving highlight. */
  activeAt(recording: string, captureNs: number, tailNs: number): TextMark[] {
    const index = this.recordings.indexOf(recording);
    if (index < 0) return [];
    return this.marks.filter(
      (mark) => mark.recording === index && mark.startNs <= captureNs && captureNs <= mark.endNs + tailNs,
    );
  }

  recordingOf(mark: TextMark): string | undefined {
    return this.recordings[mark.recording];
  }

  /**
   * After a split of the recording `from`, gives each of its marks to the half that holds the mark's start. A tap
   * on the text then still finds its audio. Returns whether any mark moved.
   */
  moveToSplit(from: string, halves: readonly SplitHalf[]): boolean {
    const index = this.recordings.indexOf(from);
    if (index < 0) return false;
    let moved = false;
    for (const mark of this.marks) {
      const half = mark.recording === index ? halfAt(halves, mark.startNs) : undefined;
      if (!half || half.id === from) continue;
      mark.recording = this.recordingIndex(half.id);
      moved = true;
    }
    return moved;
  }
}

/** Where a tap sends the audio. */
export interface Seek {
  recording: string;
  positionNs: number;
  /** False when the moment has no audio, and the position is where the next audio starts. */
  exact: boolean;
}

export function sameTarget(a: Target, b: Target): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'text':
      return b.type === 'text' && a.block === b.block && a.from === b.from && a.to === b.to;
    default:
      return 'id' in b && a.id === b.id;
  }
}

export function isFlag(target: Target): boolean {
  return target.type === 'flag';
}

interface Sorted {
  entries: StampEntry[];
  longestNs: number;
}

/** Everything written while recordings ran, sorted by time, for lookups in both directions. */
export class StampIndex {
  private readonly recordings = new Map<string, Sorted>();

  constructor(entries: Iterable<StampEntry>) {
    for (const entry of entries) {
      const sorted = this.recordings.get(entry.recording) ?? { entries: [], longestNs: 0 };
      sorted.entries.push(entry);
      this.recordings.set(entry.recording, sorted);
    }
    for (const sorted of this.recordings.values()) {
      sorted.entries.sort((a, b) => a.startNs - b.startNs || a.endNs - b.endNs);
      sorted.longestNs = sorted.entries.reduce((longest, entry) => Math.max(longest, entry.endNs - entry.startNs), 0);
    }
  }

  get size(): number {
    let size = 0;
    for (const sorted of this.recordings.values()) size += sorted.entries.length;
    return size;
  }

  /** The first entry for a target. */
  find(target: Target): StampEntry | undefined {
    for (const sorted of this.recordings.values()) {
      const found = sorted.entries.find((entry) => sameTarget(entry.target, target));
      if (found) return found;
    }
    return undefined;
  }

  /** Where to seek for a tap on `target`. `mapOf` gives the position map of a recording. */
  seekFor(target: Target, mapOf: (recording: string) => PositionMap | undefined): Seek | null {
    const entry = this.find(target);
    const map = entry ? mapOf(entry.recording) : undefined;
    if (!entry || !map) return null;
    const located = map.locate(entry.startNs);
    return { recording: entry.recording, positionNs: located.positionNs, exact: located.exact };
  }

  /** The entries being written at `captureNs`, or in the `tailNs` before it, newest first. */
  activeAt(recording: string, captureNs: number, tailNs: number): StampEntry[] {
    const sorted = this.recordings.get(recording);
    if (!sorted) return [];
    const upto = partitionPoint(sorted.entries, (entry) => entry.startNs <= captureNs);
    const floor = Math.max(captureNs - (sorted.longestNs + tailNs), 0);
    const from = partitionPoint(sorted.entries, (entry) => entry.startNs < floor);
    return sorted.entries
      .slice(from, upto)
      .filter((entry) => captureNs <= entry.endNs + tailNs)
      .reverse();
  }

  /** The next entry after `captureNs` that `wanted` accepts, such as the next flag. */
  nextAfter(recording: string, captureNs: number, wanted: (target: Target) => boolean): StampEntry | undefined {
    const sorted = this.recordings.get(recording);
    if (!sorted) return undefined;
    const from = partitionPoint(sorted.entries, (entry) => entry.startNs <= captureNs);
    return sorted.entries.slice(from).find((entry) => wanted(entry.target));
  }

  /** The last entry before `captureNs` that `wanted` accepts. */
  previousBefore(recording: string, captureNs: number, wanted: (target: Target) => boolean): StampEntry | undefined {
    const sorted = this.recordings.get(recording);
    if (!sorted) return undefined;
    const upto = partitionPoint(sorted.entries, (entry) => entry.startNs < captureNs);
    return sorted.entries
      .slice(0, upto)
      .reverse()
      .find((entry) => wanted(entry.target));
  }
}
