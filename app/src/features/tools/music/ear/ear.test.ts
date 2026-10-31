import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import { intervalShort, midiOf, parseNote } from '../theory/notes';
import type { Note } from '../theory/notes';
import { itemAt, readChordAnswer, readIntervalAnswer, readNoteList, readScaleAnswer, syllable } from './engine';
import type { Item, Settings } from './engine';
import { grade } from './modes';
import { spec } from './tool';

const settings: Settings = { level: 'medium', range: 'mid', delivery: 'up', length: 4, bpm: 80 };
const note = (text: string): Note => parseNote(text)!;

function run(changes: Record<string, string>) {
  return runTool(spec, { ...initialValues(spec), today: '2026-09-14', ...changes });
}
const rowOf = (result: ReturnType<typeof run>, key: string, n?: string): string | undefined =>
  result.ok ? result.rows.find((r) => r.key === key && (n === undefined || r.vars?.n === n))?.value : undefined;
const wordOf = (result: ReturnType<typeof run>, key: string): string | undefined =>
  result.ok ? result.rows.find((r) => r.key === key)?.word : undefined;

describe('seeded items', () => {
  it('gives the same sequence for the same seed and settings, and another for another seed', () => {
    const show = (seed: bigint) =>
      JSON.stringify(Array.from({ length: 12 }, (_, i) => itemAt('interval', seed, settings, i + 1)));
    expect(show(5n)).toBe(show(5n));
    expect(show(5n)).not.toBe(show(6n));
  });
  it('does not depend on which item is asked for first', () => {
    const third = itemAt('chord', 9n, settings, 3);
    for (let i = 1; i <= 3; i++) itemAt('chord', 9n, settings, i);
    expect(itemAt('chord', 9n, settings, 3)).toEqual(third);
  });
  it('keeps interval roots inside the chosen register', () => {
    for (let i = 1; i <= 40; i++) {
      const item = itemAt('interval', 3n, { ...settings, range: 'low' }, i) as Extract<Item, { kind: 'interval' }>;
      expect(midiOf(item.root)).toBeGreaterThanOrEqual(48);
      expect(midiOf(item.root)).toBeLessThanOrEqual(59);
    }
  });
  it('builds rhythms of 4, 8, and 12 steps that start on a hit', () => {
    for (const [level, length] of [
      ['easy', 4],
      ['medium', 8],
      ['hard', 12],
    ] as const) {
      const item = itemAt('rhythm', 2n, { ...settings, level }, 1) as Extract<Item, { kind: 'rhythm' }>;
      expect(item.steps).toHaveLength(length);
      expect(item.steps[0]).toBe('x');
    }
  });
  it('starts a melody on the tonic and has the length asked for', () => {
    const item = itemAt('melody', 4n, { ...settings, length: 6 }, 2) as Extract<Item, { kind: 'melody' }>;
    expect(item.notes).toHaveLength(6);
    expect(item.degrees[0]).toBe(0);
  });
});

describe('reading answers', () => {
  it.each([
    ['major sixth', 9],
    ['M6', 9],
    ['perfect 5th', 7],
    ['diminished fifth', 6],
    ['tritone', 6],
    ['minor second', 1],
    ['P8', 12],
  ])('reads %s as %i semitones', (text, semis) => {
    expect(readIntervalAnswer(text)).toBe(semis);
  });
  it('does not read nonsense as an interval', () => {
    expect(readIntervalAnswer('big')).toBeNull();
    expect(readIntervalAnswer('')).toBeNull();
  });
  it('reads chord and scale names', () => {
    expect(readChordAnswer('Dominant Seventh')).toBe('dominant7');
    expect(readChordAnswer('m7')).toBe('minor7');
    expect(readChordAnswer('ø7')).toBe('halfDiminished7');
    expect(readChordAnswer('purple')).toBeNull();
    expect(readScaleAnswer('Natural minor')).toBe('aeolian');
    expect(readScaleAnswer('harmonic minor')).toBe('harmonicMinor');
  });
  it('reads note lists with or without octaves', () => {
    expect(readNoteList('C D F')).toEqual([
      { step: 0, alt: 0 },
      { step: 1, alt: 0 },
      { step: 3, alt: 0 },
    ]);
    expect(readNoteList('C4 Eb')?.[0]).toEqual({ step: 0, alt: 0, octave: 4 });
    expect(readNoteList('C X')).toBeNull();
  });
});

describe('grading', () => {
  it('accepts major sixth for C4 up to A4', () => {
    const item = {
      kind: 'interval',
      n: 1,
      root: note('C4'),
      interval: { generic: 6, quality: 'M', times: 0, semitones: 9 },
      delivery: 'up',
      plan: {},
    } as unknown as Item;
    expect(grade(item, 'major sixth').correct).toBe(true);
    expect(grade(item, 'minor sixth').correct).toBe(false);
    expect(intervalShort(item.kind === 'interval' ? item.interval : (null as never))).toBe('M6');
  });
  it('marks notes 1 and 2 right and note 3 wrong for C D F against C D E', () => {
    const item = {
      kind: 'melody',
      n: 1,
      tonic: note('C4'),
      notes: [note('C4'), note('D4'), note('E4')],
      degrees: [0, 1, 2],
      plan: {},
    } as unknown as Item;
    const result = grade(item, 'C D F');
    expect(result.correct).toBe(false);
    expect(result.rows.map((r) => r.value)).toEqual(['correct', 'correct', 'wrong: F for E']);
  });
  it('marks a rhythm step by step', () => {
    const item = { kind: 'rhythm', n: 1, steps: 'x.xx', plan: {} } as unknown as Item;
    expect(grade(item, 'x.xx').correct).toBe(true);
    expect(grade(item, 'x x . x').correct).toBe(false);
    expect(grade(item, 'x.x.').rows).toHaveLength(1);
  });
});

describe('solfege', () => {
  it('names movable-do and minor syllables', () => {
    expect(syllable(0, false, 'la')).toBe('do');
    expect(syllable(5, false, 'la')).toBe('la');
    expect(syllable(0, true, 'la')).toBe('la');
    expect(syllable(2, true, 'do')).toBe('me');
    expect(syllable(7, false, 'la')).toBe('do');
    expect(syllable(-1, false, 'la')).toBe('ti');
  });
});

describe('the ear form', () => {
  it('asks for an answer before showing one', () => {
    const result = run({ mode: 'interval', seed: '7', item: '2' });
    expect(wordOf(result, 'promptOut')).toBe('promptListen');
    expect(result.ok && result.play?.notes.length).toBe(2);
    expect(result.ok && result.rows.some((r) => r.key === 'rightOut')).toBe(false);
  });
  it('grades a typed answer and gives the right one', () => {
    const item = itemAt('interval', 7n, { ...settings, level: 'easy' }, 2) as Extract<Item, { kind: 'interval' }>;
    const right = run({ mode: 'interval', seed: '7', item: '2', answer: intervalShort(item.interval) });
    expect(wordOf(right, 'resultOut')).toBe('resultCorrect');
    const wrong = run({ mode: 'interval', seed: '7', item: '2', answer: item.interval.semitones === 7 ? 'm2' : 'P5' });
    expect(wordOf(wrong, 'resultOut')).toBe('resultWrong');
    expect(rowOf(wrong, 'rightOut')).toContain(intervalShort(item.interval));
  });
  it('gives sight-singing syllables for the whole melody', () => {
    const result = run({ mode: 'sing', seed: '3', length: '5' });
    expect(rowOf(result, 'solfegeOut')?.split(' ')).toHaveLength(5);
  });
  it('grades a session and schedules the missed items for today', () => {
    const items = [1, 2, 3].map(
      (n) => itemAt('chord', 4n, { ...settings, level: 'easy' }, n) as Extract<Item, { kind: 'chord' }>,
    );
    const answers = items
      .map((it, i) => (i === 1 ? (it.qualityId === 'major' ? 'minor' : 'major') : it.qualityId))
      .join('\n');
    const result = run({ mode: 'chord', run: 'session', seed: '4', answers });
    expect(rowOf(result, 'scoreOut')).toBe('2 of 3');
    expect(rowOf(result, 'weakOut')).toBe('2');
    expect(rowOf(result, 'sessionRow', '1')).toBe('correct; next review 2026-09-15');
    expect(rowOf(result, 'sessionRow', '2')).toMatch(/^wrong, you wrote .*; review 2026-09-14$/);
  });
  it.each([
    [{ seed: 'x' }, 'earSeedFormat'],
    [{ item: '0' }, 'earItemRange'],
    [{ item: '1.5' }, 'earItemRange'],
    [{ bpm: '5' }, 'earBpmRange'],
    [{ answer: 'banana' }, 'earIntervalFormat'],
    [{ mode: 'melody', length: '2' }, 'earLengthRange'],
    [{ mode: 'sing', run: 'session' }, 'earNoGrade'],
    [{ run: 'session', answers: '' }, 'earNoAnswers'],
    [{ run: 'session', answers: 'P5', today: 'soon' }, 'earDateFormat'],
  ])('rejects %j as %s', (changes, error) => {
    const result = run(changes);
    expect(!result.ok && result.error).toBe(error);
  });
});
