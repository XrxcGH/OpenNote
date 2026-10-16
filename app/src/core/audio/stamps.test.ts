// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PositionMap } from './positions';
import { isFlag, StampIndex, TextMarks } from './stamps';
import type { StampEntry, Target } from './types';

function fixture<T>(name: string): T {
  const url = new URL(`../../../../crates/media/tests/fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T;
}

interface Step {
  type?: { at: number; count: number; startMs: number; everyMs: number; recording: string };
  edit?: {
    at: number;
    deleted: number;
    inserted: number;
    stamp?: { recording: string; captureMs: number };
  };
}

/** Applies the steps of a shared case to new marks, as the Rust test does. */
function run(steps: Step[]): TextMarks {
  const marks = new TextMarks();
  for (const step of steps) {
    if (step.type) {
      const { at, count, startMs, everyMs, recording } = step.type;
      for (let index = 0; index < count; index += 1) {
        marks.edit(at + index, 0, 1, { recording, captureNs: (startMs + index * everyMs) * 1_000_000 });
      }
    } else if (step.edit) {
      const { at, deleted, inserted, stamp } = step.edit;
      marks.edit(
        at,
        deleted,
        inserted,
        stamp && { recording: stamp.recording, captureNs: stamp.captureMs * 1_000_000 },
      );
    }
  }
  return marks;
}

describe('TextMarks', () => {
  const cases = fixture<{
    cases: {
      name: string;
      steps: Step[];
      recordings: string[];
      marks: [number, number, number, number, number][];
      timeAt: [number, string | null, number | null][];
    }[];
    active: {
      steps: Step[];
      queries: { recording: string; captureNs: number; tailNs: number; from: number[] }[];
    };
  }>('text-marks.json');

  for (const shared of cases.cases) {
    it(`matches the Rust marks: ${shared.name}`, () => {
      const marks = run(shared.steps);
      expect(marks.recordings).toEqual(shared.recordings);
      expect(marks.marks.map((m) => [m.from, m.to, m.recording, m.startNs, m.endNs])).toEqual(shared.marks);
      for (const [offset, recording, captureNs] of shared.timeAt) {
        expect(marks.timeAt(offset), `offset ${offset}`).toEqual(recording === null ? null : { recording, captureNs });
      }
    });
  }

  it('follows the highlight the way the Rust marks do', () => {
    const marks = run(cases.active.steps);
    for (const { recording, captureNs, tailNs, from } of cases.active.queries) {
      expect(marks.activeAt(recording, captureNs, tailNs).map((m) => m.from)).toEqual(from);
    }
  });

  it('survives a round trip through the data the page keeps', () => {
    const marks = run(cases.cases[0]?.steps ?? []);
    const again = new TextMarks(JSON.parse(JSON.stringify(marks.toData())));
    expect(again.marks).toEqual(marks.marks);
    expect(again.recordingOf(again.marks[0]!)).toBe('r1');
  });

  it('gives each half of a split the marks typed inside it', () => {
    const marks = new TextMarks();
    marks.edit(0, 0, 5, { recording: 'r1', captureNs: 1_000_000_000 });
    marks.edit(5, 0, 1, { recording: 'r2', captureNs: 1_500_000_000 });
    marks.edit(6, 0, 5, { recording: 'r1', captureNs: 9_000_000_000 });
    const halves = [
      { id: 'r1', startedNs: 0, endedNs: 5_000_000_000 },
      { id: 'r1b', startedNs: 5_000_000_000, endedNs: 12_000_000_000 },
    ];
    expect(marks.moveToSplit('r1', halves)).toBe(true);
    expect(marks.timeAt(2)).toEqual({ recording: 'r1', captureNs: 1_000_000_000 });
    expect(marks.timeAt(5)?.recording).toBe('r2');
    expect(marks.timeAt(8)).toEqual({ recording: 'r1b', captureNs: 9_000_000_000 });
    expect(marks.moveToSplit('r1', halves)).toBe(false);
    expect(marks.moveToSplit('gone', halves)).toBe(false);
  });
});

describe('TextMarks under random edits', () => {
  it('keeps marks on their words through random edits', () => {
    // A small deterministic generator, so a failure repeats.
    let seed = 7;
    const next = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    const text: number[] = [];
    const marks = new TextMarks();
    let clockMs = 10_000;
    for (let round = 0; round < 200; round += 1) {
      clockMs += 5_000;
      const at = next(text.length + 1);
      const kind = next(3);
      const deleted = kind === 0 ? 0 : Math.min(1 + next(6), text.length - at);
      const inserted = kind === 1 ? 0 : 1 + next(8);
      marks.edit(at, deleted, inserted, { recording: 'r', captureNs: clockMs * 1_000_000 });
      text.splice(at, deleted, ...Array<number>(inserted).fill(clockMs));
      text.forEach((typedMs, offset) => {
        expect(marks.timeAt(offset)).toEqual({ recording: 'r', captureNs: typedMs * 1_000_000 });
      });
      expect(marks.timeAt(text.length)).toBeNull();
    }
  });
});

describe('StampIndex', () => {
  const cases = fixture<{
    ranges: [number, number][];
    entries: StampEntry[];
    active: { recording: string; captureNs: number; tailNs: number; ids: string[] }[];
    seek: {
      target: Target;
      recording: string | null;
      positionNs: number | null;
      exact: boolean | null;
    }[];
    nextFlag: { after: number; id: string | null }[];
    previousFlag: { before: number; id: string | null }[];
  }>('stamp-index.json');
  const index = new StampIndex(cases.entries);
  const map = PositionMap.fromRanges(cases.ranges);
  const flagId = (entry: StampEntry | undefined) => (entry?.target.type === 'flag' ? entry.target.id : null);

  it('names what was being written, newest first', () => {
    for (const { recording, captureNs, tailNs, ids } of cases.active) {
      const found = index.activeAt(recording, captureNs, tailNs);
      expect(found.filter((e) => e.target.type === 'stroke').map((e) => (e.target as { id: string }).id)).toEqual(ids);
    }
  });

  it('sends a tap to the right place in the audio', () => {
    for (const { target, recording, positionNs, exact } of cases.seek) {
      const seek = index.seekFor(target, () => map);
      expect(seek, JSON.stringify(target)).toEqual(recording === null ? null : { recording, positionNs, exact });
    }
  });

  it('jumps between flags in both directions', () => {
    for (const { after, id } of cases.nextFlag) expect(flagId(index.nextAfter('r1', after, isFlag))).toBe(id);
    for (const { before, id } of cases.previousFlag)
      expect(flagId(index.previousBefore('r1', before, isFlag))).toBe(id);
  });

  it('counts its entries', () => {
    expect(index.size).toBe(cases.entries.length);
  });
});
