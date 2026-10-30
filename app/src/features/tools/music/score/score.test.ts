import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import { midiOf, noteName } from '../theory/notes';
import { AbcError, checkBars, countBars, countNotes, parseAbc, timeline, writeAbc } from './abc';
import { tabFor } from './views';
import { spec } from './tool';

const SCALE = 'X:1\nM:4/4\nL:1/8\nK:C\nCDEF GABc|';

function run(mode: string, changes: Record<string, string> = {}) {
  return runTool(spec, { ...initialValues(spec), abc: SCALE, mode, ...changes });
}
const rowOf = (result: ReturnType<typeof run>, key: string): string | undefined =>
  result.ok ? result.rows.find((r) => r.key === key)?.value : undefined;
const pitches = (abc: string): string[] =>
  parseAbc(abc).voices[0]!.items.flatMap((i) => (i.kind === 'note' ? i.pitches.map(noteName) : []));

describe('reading ABC', () => {
  it('reads CDEF GABc as eight notes in one bar of 4/4', () => {
    const tune = parseAbc(SCALE);
    expect(countNotes(tune.voices[0]!)).toBe(8);
    expect(countBars(tune.voices[0]!)).toBe(1);
    expect(checkBars(tune)).toEqual([]);
    expect(pitches(SCALE)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
  });
  it('takes the default note length from the meter', () => {
    expect(parseAbc('M:4/4\nK:C\nC').unit).toBe(1 / 8);
    expect(parseAbc('M:2/4\nK:C\nC').unit).toBe(1 / 16);
    expect(parseAbc('M:4/4\nL:1/4\nK:C\nC').unit).toBe(1 / 4);
  });
  it('applies the key signature and lets an accidental last to the bar line', () => {
    expect(pitches('K:G\nF^FFf|F')).toEqual(['F♯4', 'F♯4', 'F♯4', 'F♯5', 'F♯4']);
    expect(pitches('K:C\n^FFf|F')).toEqual(['F♯4', 'F♯4', 'F5', 'F4']);
    expect(pitches('K:G\n=FF')).toEqual(['F4', 'F4']);
  });
  it('reads octave marks, rests, and lengths', () => {
    const tune = parseAbc('M:4/4\nL:1/4\nK:C\nC, c\' z2 D/ E3/2 [CEG]2|');
    const durs = tune.voices[0]!.items.filter((i) => i.kind !== 'bar').map((i) => (i as { dur: number }).dur);
    expect(durs).toEqual([0.25, 0.25, 0.5, 0.125, 0.375, 0.5]);
    expect(pitches('K:C\nC, c\' C,, c\'\'')).toEqual(['C3', 'C6', 'C2', 'C7']);
  });
  it('reads ties, chords, and triplets', () => {
    const tune = parseAbc('M:4/4\nL:1/8\nK:C\nC-C [CE]2 (3DEF|');
    const items = tune.voices[0]!.items.filter((i) => i.kind !== 'bar');
    expect((items[0] as { tied: boolean }).tied).toBe(true);
    expect((items[2] as { pitches: unknown[] }).pitches).toHaveLength(2);
    expect((items[3] as { dur: number }).dur).toBeCloseTo(0.125 * (2 / 3), 9);
    const beats = timeline(tune.voices[0]!);
    expect(beats[0]!.dur).toBe(1);
  });
  it('flags a bar of the wrong length but allows a short first and last bar', () => {
    expect(checkBars(parseAbc('M:4/4\nL:1/4\nK:C\nCDE|CDEF|CDEF|CD|'))).toEqual([]);
    const bad = checkBars(parseAbc('M:4/4\nL:1/4\nK:C\nCDEF|CDE|CDEF|C|'));
    expect(bad.map((b) => b.bar)).toEqual([2]);
  });
  it('keeps voices apart', () => {
    const tune = parseAbc('M:4/4\nL:1/4\nK:C\nV:1\nCDEF|\nV:2\nC,D,E,F,|');
    expect(tune.voices.map((v) => v.id)).toEqual(['1', '2']);
  });
  it.each([
    ['', 'empty'],
    ['M:4/4\nCDE', 'noKey'],
    ['K:C\nCD#E', 'char'],
    ['M:4\nK:C\nC', 'meter'],
    ['K:H\nC', 'key'],
    ['L:oops\nK:C\nC', 'length'],
    ['K:C\n[CE', 'chord'],
  ])('rejects %j as %s', (abc, code) => {
    expect(() => parseAbc(abc)).toThrow(AbcError);
    try {
      parseAbc(abc);
    } catch (error) {
      expect((error as AbcError).code).toBe(code);
    }
  });
});

describe('writing and transposing', () => {
  it('writes a tune back so it reads the same', () => {
    const tune = parseAbc('M:3/4\nL:1/8\nK:F\nF2 A2 c2|_B^c e-e [FAc]2 z2|');
    const back = parseAbc(writeAbc(tune));
    expect(pitches(writeAbc(tune))).toEqual(pitches('M:3/4\nL:1/8\nK:F\nF2 A2 c2|_B^c e-e [FAc]2 z2|'));
    expect(back.meter).toEqual(tune.meter);
    expect(timeline(back.voices[0]!).map((t) => t.dur)).toEqual(timeline(tune.voices[0]!).map((t) => t.dur));
  });
  it('transposes the C major scale up a major second into D major', () => {
    const result = run('transpose', { interval: 'M2' });
    const code = result.ok ? result.code! : '';
    expect(code).toContain('K:D');
    expect(pitches(code)).toEqual(['D4', 'E4', 'F♯4', 'G4', 'A4', 'B4', 'C♯5', 'D5']);
    expect(code.split('\n').pop()).toBe('D E F G A B c d |');
  });
  it('goes to the nearest way into a key and keeps the mode', () => {
    const result = run('transpose', { toKey: 'G' });
    expect(result.ok && result.code).toContain('K:G');
    expect(pitches(result.ok ? result.code! : '')[0]).toBe('G3');
    const minor = run('transpose', { abc: 'M:4/4\nK:Am\nABcd|', toKey: 'C' });
    expect(minor.ok && minor.code).toContain('K:Cm');
  });
  it('writes the part for a B-flat clarinet a major second higher', () => {
    const result = run('instrument', { instrumentId: 'clarinetBb' });
    expect(result.ok && result.code).toContain('K:D');
  });
  it('says when a move needs too many accidentals', () => {
    const result = run('transpose', { abc: 'M:4/4\nK:F#\nF|', interval: 'A4' });
    expect(!result.ok && result.error).toBe('scoreKeyTooFar');
  });
});

describe('other notations', () => {
  it('numbers the C major scale 1 to 7 with a dot above the octave', () => {
    const result = run('jianpu');
    expect(rowOf(result, 'jianpuPlain')).toBe('1 2 3 4 5 6 7 1̇ |');
    expect(rowOf(result, 'jianpuTimed')).toBe(
      ['1', '2', '3', '4', '5', '6', '7', '1̇'].map((d) => `${d}̲`).join(' ') + ' |',
    );
  });
  it('counts from the relative major in a minor key and marks chromatic notes', () => {
    expect(rowOf(run('jianpu', { abc: 'M:4/4\nL:1/4\nK:Am\nABc^c|' }), 'jianpuPlain')).toBe('6 7 1̇ ♯1̇ |');
  });
  it('shows lengths as dashes and dots', () => {
    const result = run('jianpu', { abc: 'M:4/4\nL:1/4\nK:C\nC2 D3 E3/2 F/|' });
    expect(rowOf(result, 'jianpuTimed')).toBe('1 - 2 - - 3· 4̲ |');
  });
  it('writes the C major scale in sargam', () => {
    expect(rowOf(run('sargam'), 'sargamRow')).toBe("S R G M P D N S' |");
  });
  it('writes komal and tivra notes in sargam', () => {
    const result = run('sargam', { abc: 'M:4/4\nL:1/4\nK:C\nC _D _E ^F _B|' });
    expect(rowOf(result, 'sargamRow')).toBe('S r g M♯ n |');
  });
  it('puts the low E and A open strings on strings 6 and 5', () => {
    const result = run('tab', { abc: 'M:4/4\nL:1/4\nK:C\nE,, A,,|' });
    expect(rowOf(result, 'tabRow')).toBe('6:0 5:0 |');
    expect(result.ok && result.code?.split('\n')).toHaveLength(6);
  });
  it('finds frets by the lowest fret within the hand span', () => {
    const found = tabFor([midiOf({ step: 4, alt: 0, octave: 3 })], null);
    expect(found?.notes).toEqual([{ string: 3, fret: 0 }]);
    expect(tabFor([midiOf({ step: 0, alt: 0, octave: 4 })], null)?.notes).toEqual([{ string: 2, fret: 1 }]);
    // E2 B2 E3 is the open low E, B on the fifth string's second fret, and E on the fourth string's second fret.
    expect(tabFor([40, 47, 52], null)?.notes.map((n) => `${n.string}:${n.fret}`)).toEqual(['6:0', '5:2', '4:2']);
  });
  it('refuses a note no guitar can play', () => {
    const result = run('tab', { abc: 'M:4/4\nK:C\nC,,,|' });
    expect(!result.ok && result.error).toBe('scoreTabRange');
  });
});

describe('the score form', () => {
  it('summarizes the starting tune, engraves it, and plans playback', () => {
    const result = run('engrave');
    expect(rowOf(result, 'tuneNotes')).toBe('8');
    expect(rowOf(result, 'tuneBars')).toBe('1');
    expect(rowOf(result, 'tuneKey')).toBe('C major');
    expect(result.ok && result.svg?.markup).toContain('<svg');
    expect(result.ok && result.play?.notes).toHaveLength(8);
    expect(result.ok && result.play?.bpm).toBe(120);
  });
  it('reports a bar of the wrong length', () => {
    const result = run('engrave', { abc: 'M:4/4\nL:1/4\nK:C\nCDEF|CDE|CDEF|C|' });
    expect(rowOf(result, 'barWarn')).toBe('3 of 4 beats');
  });
  it('picks one voice', () => {
    const abc = 'M:4/4\nL:1/4\nK:C\nV:1\nCDEF|\nV:2\nC,D,E,F,|';
    expect(rowOf(run('sargam', { abc, voice: '2' }), 'sargamRow')).toBe('S, R, G, M, |');
    const unknown = run('sargam', { abc, voice: '9' });
    expect(!unknown.ok && unknown.error).toBe('scoreVoiceUnknown');
  });
  it.each([
    [{ abc: '' }, 'scoreEmpty'],
    [{ abc: 'M:4/4\nCDE' }, 'scoreNoKey'],
    [{ abc: 'K:C\nC%D\nD#' }, 'scoreChar'],
    [{ mode: 'transpose', interval: 'X9' }, 'scoreIntervalFormat'],
    [{ mode: 'transpose', toKey: 'Q' }, 'scoreToKeyFormat'],
    [{ abc: 'K:C\n' + 'C'.repeat(25_000) }, 'scoreTooLong'],
  ])('rejects %j as %s', (changes, error) => {
    const result = run(changes.mode ?? 'engrave', changes);
    expect(!result.ok && result.error).toBe(error);
  });
});
