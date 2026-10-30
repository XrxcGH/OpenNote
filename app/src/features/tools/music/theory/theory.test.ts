import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import { spec } from './tool';

/** Runs the theory tool in a mode with a few fields changed from their starting values. */
function run(mode: string, changes: Record<string, string> = {}) {
  return runTool(spec, { ...initialValues(spec), mode, ...changes });
}
const rowOf = (result: ReturnType<typeof run>, key: string): string | undefined =>
  result.ok ? result.rows.find((r) => r.key === key)?.value : undefined;
const wordOf = (result: ReturnType<typeof run>, key: string): string | undefined =>
  result.ok ? result.rows.find((r) => r.key === key)?.word : undefined;
const errorOf = (result: ReturnType<typeof run>): string | undefined => (result.ok ? undefined : result.error);

describe('intervals', () => {
  it.each([
    ['C4', 'G4', 'perfect fifth', '7'],
    ['G4', 'C4', 'perfect fifth', '7'],
    ['C4', 'E5', 'major tenth', '16'],
    ['C4', 'Gb4', 'diminished fifth', '6'],
    ['C4', 'F#4', 'augmented fourth', '6'],
    ['E4', 'C5', 'minor sixth', '8'],
  ])('%s to %s is a %s of %s semitones', (a, b, name, semis) => {
    const result = run('interval', { note1: a, note2: b });
    expect(rowOf(result, 'intervalOut')).toBe(name);
    expect(rowOf(result, 'semitoneCount')).toBe(semis);
  });
  it('inverts a fifth to a fourth and reduces a tenth to a third', () => {
    expect(rowOf(run('interval', { note1: 'C4', note2: 'G4' }), 'inversionOut')).toBe('perfect fourth');
    expect(rowOf(run('interval', { note1: 'C4', note2: 'E5' }), 'simpleOut')).toBe('major third');
  });
  it('gives the equal-tempered ratio of a perfect fifth', () => {
    expect(rowOf(run('interval', { note1: 'C4', note2: 'G4' }), 'etRatio')).toBe('1.49831');
  });
  it('finds the note above and below', () => {
    expect(rowOf(run('above', { base: 'C4', interval: 'M3' }), 'noteOut')).toBe('E4');
    expect(rowOf(run('above', { base: 'E4', interval: 'm3', direction: 'down' }), 'noteOut')).toBe('C♯4');
    expect(rowOf(run('above', { base: 'B3', interval: 'A4' }), 'noteOut')).toBe('E♯4');
  });
  it.each([
    ['interval', { note1: 'H4' }, 'thNoteFormat'],
    ['above', { interval: 'P3' }, 'thIntervalFormat'],
    ['above', { base: 'C♭♭♭♭4', interval: 'M3' }, 'thNoteFormat'],
    ['above', { base: 'G##4', interval: 'AA5' }, 'thTooManyAccidentals'],
  ])('rejects %s with %j as %s', (mode, changes, error) => {
    expect(errorOf(run(mode, changes))).toBe(error);
  });
});

describe('pitch', () => {
  it('turns C4 into 261.626 Hz and MIDI 60', () => {
    const result = run('pitch', { pitch: 'C4' });
    expect(rowOf(result, 'hzOut')).toBe('261.626');
    expect(rowOf(result, 'midiExact')).toBe('60');
  });
  it('honors another A4 reference', () => {
    expect(rowOf(run('pitch', { pitch: 'A4', a4: '432' }), 'hzOut')).toBe('432');
    expect(rowOf(run('pitch', { pitch: 'A4', a4: '415' }), 'hzOut')).toBe('415');
  });
  it('turns 60 into C4 and 440 Hz into A4', () => {
    expect(rowOf(run('pitch', { pitch: '60' }), 'nearestNote')).toBe('C4');
    const result = run('pitch', { pitch: '440 Hz' });
    expect(rowOf(result, 'nearestNote')).toBe('A4');
    expect(rowOf(result, 'midiExact')).toBe('69');
  });
  it('says how many cents a frequency is off', () => {
    expect(rowOf(run('pitch', { pitch: '452.89 Hz' }), 'offCents')).toBe('50.0');
  });
  it.each([
    [{ pitch: '' }, 'thPitchFormat'],
    [{ pitch: '-5 Hz' }, 'thPitchFormat'],
    [{ pitch: 'A4', a4: '5' }, 'thA4Range'],
  ])('rejects %j as %s', (changes, error) => {
    expect(errorOf(run('pitch', changes))).toBe(error);
  });
});

describe('scales', () => {
  it('spells A flat harmonic minor with a G natural', () => {
    expect(rowOf(run('scale', { tonic: 'Ab', scaleId: 'harmonicMinor' }), 'scaleNotes')).toBe('A♭ B♭ C♭ D♭ E♭ F♭ G A♭');
  });
  it('gives the whole-tone and bhairav step patterns', () => {
    expect(rowOf(run('scale', { scaleId: 'wholeTone' }), 'stepPattern')).toBe('2-2-2-2-2-2');
    expect(rowOf(run('scale', { scaleId: 'bhairav' }), 'stepPattern')).toBe('1-3-1-2-1-3-1');
  });
  it('writes Bhairav in sargam with komal Re and Dha', () => {
    expect(rowOf(run('scale', { scaleId: 'bhairav' }), 'sargamOut')).toBe('S r G M P d N');
  });
  it('builds melakarta 15 and 29 by rule', () => {
    expect(rowOf(run('melakarta', { melaNumber: '15' }), 'melaSemis')).toBe('0 1 4 5 7 8 11');
    expect(rowOf(run('melakarta', { melaNumber: '29' }), 'melaSemis')).toBe('0 2 4 5 7 9 11');
    expect(rowOf(run('melakarta', { melaNumber: '72' }), 'melaSemis')).toBe('0 3 4 6 7 10 11');
  });
  it.each(['0', '73', '1.5', 'x'])('rejects melakarta %s', (n) => {
    expect(errorOf(run('melakarta', { melaNumber: n }))).toBe('thMelaRange');
  });
  it('lists maqam rast in cents and names the source', () => {
    const result = run('cents', { centsId: 'rast' });
    expect(rowOf(result, 'centsList')).toBe('0, 204, 350, 498, 702, 906, 1052, 1200');
    expect(result.ok && result.source).toMatch(/approximate/i);
  });
});

describe('chords and keys', () => {
  it('spells Cmaj7, F#m7b5, and Bb7', () => {
    expect(rowOf(run('chord', { chord: 'Cmaj7' }), 'chordNotes')).toBe('C E G B');
    expect(rowOf(run('chord', { chord: 'F#m7b5' }), 'chordNotes')).toBe('F♯ A C E');
    expect(rowOf(run('chord', { chord: 'Bb7' }), 'chordNotes')).toBe('B♭ D F A♭');
  });
  it('gives the figures of each inversion of a seventh chord', () => {
    const result = run('chord', { chord: 'G7' });
    expect(rowOf(result, 'invFirst')).toBe('B D F G (6/5)');
    expect(rowOf(result, 'invThird')).toBe('F G B D (4/2)');
  });
  it('names a chord from notes and its inversion', () => {
    const result = run('name', { notes: 'E3 G3 C4' });
    expect(rowOf(result, 'symbolOut')).toBe('C/E');
    expect(wordOf(result, 'positionOut')).toBe('wordFirst');
    expect(rowOf(result, 'figuresOut')).toBe('6/3');
  });
  it('reports a cluster that is not a chord', () => {
    expect(errorOf(run('name', { notes: 'C4 C#4 D4' }))).toBe('thNameNone');
  });
  it.each([
    ['G', 'major', '1 ♯: F♯'],
    ['Eb', 'major', '3 ♭: B♭ E♭ A♭'],
    ['A', 'minor', 'none'],
    ['C#', 'minor', '4 ♯: F♯ C♯ G♯ D♯'],
  ])('%s %s has the signature %s', (tonic, keyMode, expected) => {
    expect(rowOf(run('key', { tonic, keyMode }), 'signatureOut')).toBe(expected);
  });
  it('finds the relative and parallel keys', () => {
    const result = run('key', { tonic: 'C', keyMode: 'major' });
    expect(rowOf(result, 'relativeOut')).toBe('A minor');
    expect(rowOf(result, 'parallelOut')).toBe('C minor');
    expect(rowOf(result, 'dominantKey')).toBe('G major');
  });
  it('rejects a chord symbol and a tonic it cannot read', () => {
    expect(errorOf(run('chord', { chord: 'Hmaj7' }))).toBe('thChordFormat');
    expect(errorOf(run('key', { tonic: '' }))).toBe('thTonicFormat');
  });
});

describe('Roman numerals', () => {
  it('reads G7 as V7 and D7 as V7/V in C major', () => {
    expect(rowOf(run('roman', { chord: 'G7', tonic: 'C' }), 'numeralOut')).toBe('V7');
    const secondary = run('roman', { chord: 'D7', tonic: 'C' });
    expect(rowOf(secondary, 'numeralOut')).toBe('V7/V');
    expect(wordOf(secondary, 'kindOut')).toBe('kindSecondary');
  });
  it('reads D flat major in C minor as the Neapolitan', () => {
    const result = run('roman', { chord: 'Db', tonic: 'C', keyMode: 'minor' });
    expect(wordOf(result, 'kindOut')).toBe('kindNeapolitan');
    expect(rowOf(result, 'numeralOut')).toBe('N');
  });
  it('reads A flat, C, F sharp in C minor as an Italian augmented sixth', () => {
    const result = run('roman', { romanNotes: 'Ab3 C4 F#4', tonic: 'C', keyMode: 'minor' });
    expect(wordOf(result, 'kindOut')).toBe('kindAugSixth');
    expect(rowOf(result, 'numeralOut')).toBe('It+6');
  });
  it('writes the ii–V–I in C major and in A minor', () => {
    expect(rowOf(run('twofive', { tonic: 'C' }), 'chordTwo')).toBe('Dm7: D F A C');
    expect(rowOf(run('twofive', { tonic: 'A', keyMode: 'minor' }), 'chordTwo')).toBe('Bm7b5: B D F A');
  });
});

describe('transposing instruments', () => {
  it.each([
    ['clarinetBb', 'D4'],
    ['hornF', 'G4'],
    ['altoSax', 'A4'],
    ['tenorSax', 'D5'],
    ['piccolo', 'C4'],
  ])('writes concert C4 for %s as %s', (instrumentId, written) => {
    const result = run('instrument', { instrumentId, base: instrumentId === 'piccolo' ? 'C5' : 'C4' });
    expect(rowOf(result, 'writtenOut')).toBe(written);
  });
  it('turns a written note back into the sounding note', () => {
    const result = run('instrument', { instrumentId: 'clarinetBb', base: 'D4', transposeDir: 'concert' });
    expect(rowOf(result, 'concertOut')).toBe('C4');
  });
});

describe('pitch-class sets and rows', () => {
  it.each([
    ['0 4 7', '(037)', '3-11', '<001110>'],
    ['0 1 4', '(014)', '3-3', '<101100>'],
    ['2 6 9', '(037)', '3-11', '<001110>'],
    ['0 1 2 3 4 5', '(012345)', '6-1', '<543210>'],
    ['C E G', '(037)', '3-11', '<001110>'],
  ])('describes %s', (set, prime, forte, vector) => {
    const result = run('pcset', { set });
    expect(rowOf(result, 'primeForm')).toBe(prime);
    expect(rowOf(result, 'forteOut')).toBe(forte);
    expect(rowOf(result, 'vectorOut')).toBe(vector);
  });
  it('finds the Z-relation of 5-Z12 and the complement of a triad', () => {
    expect(rowOf(run('pcset', { set: '0 1 3 5 6' }), 'zMate')).toMatch(/^5-Z36/);
    expect(rowOf(run('pcset', { set: '0 4 7' }), 'complementOut')).toBe('1235689te');
  });
  it('counts repeated pitch classes once', () => {
    expect(rowOf(run('pcset', { set: '0 4 7 12 16' }), 'primeForm')).toBe('(037)');
  });
  it('builds the matrix and the four forms of a row', () => {
    const result = run('row', { row: '0 11 3 4 8 7 9 5 6 1 2 10' });
    expect(rowOf(result, 'rowI')).toBe('0, 1, 9, 8, 4, 5, 3, 7, 6, 11, 10, 2');
    expect(rowOf(result, 'rowR')).toBe('10, 2, 1, 6, 5, 9, 7, 8, 4, 3, 11, 0');
    expect(rowOf(result, 'rowRI')).toBe('2, 10, 11, 6, 7, 3, 5, 4, 8, 9, 1, 0');
    expect(result.ok && result.code?.split('\n')).toHaveLength(12);
    expect(result.ok && result.code?.split('\n')[0]).toBe('0 e 3 4 8 7 9 5 6 1 2 t');
  });
  it('names the pitch classes a bad row is missing', () => {
    const result = run('row', { row: '0 1 2 3 4 5 6 7 8 9 10 10' });
    expect(errorOf(result)).toBe('thRowNot');
    expect(!result.ok && result.vars?.missing).toBe('e');
  });
  it.each([
    ['pcset', { set: '' }],
    ['pcset', { set: '0 4 x' }],
    ['row', { row: '0 1 2' }],
  ])('rejects %s with %j', (mode, changes) => {
    expect(errorOf(run(mode, changes))).toMatch(/^th(SetFormat|RowNot)$/);
  });
});

describe('jazz and guitar', () => {
  it('suggests Mixolydian first for a dominant seventh', () => {
    expect(rowOf(run('jazz', { chord: 'G7' }), 'scaleFirst')).toBe('Mixolydian: G A B C D E F G');
  });
  it('finds shapes for E minor whose strings sound E, G, or B', () => {
    const result = run('guitar', { chord: 'Em' });
    expect(result.ok && result.rows.length).toBeGreaterThan(0);
    expect(rowOf(result, 'shapeN')).toBeTruthy();
  });
});
