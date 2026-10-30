import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import { checkChorale, readChords } from './chorale';
import { checkSpecies, readNotes } from './species';
import { spec } from './tool';

function run(changes: Record<string, string>) {
  return runTool(spec, { ...initialValues(spec), ...changes });
}
const rowOf = (result: ReturnType<typeof run>, key: string): string | undefined =>
  result.ok ? result.rows.find((r) => r.key === key)?.value : undefined;
const wordOf = (result: ReturnType<typeof run>, key: string): string | undefined =>
  result.ok ? result.rows.find((r) => r.key === key)?.word : undefined;

function chorale(
  text: string,
  level: 'relaxed' | 'standard' | 'strict' = 'standard',
  tonic = 'C',
  mode: 'major' | 'minor' = 'major',
) {
  const read = readChords(text);
  if (!('chords' in read)) throw new Error('bad chords');
  return checkChorale(read.chords, { step: 'CDEFGAB'.indexOf(tonic[0]!), alt: 0 }, mode, level);
}
const summary = (text: string, level: 'relaxed' | 'standard' | 'strict' = 'standard') =>
  chorale(text, level).issues.map((i) => `${i.chord}:${i.voices.join('-')}:${i.rule}`);

describe('four-part chorale checks', () => {
  it('finds parallel fifths and octaves in I to ii', () => {
    expect(summary('C5 E4 G3 C3\nD5 F4 A3 D3').sort()).toEqual([
      '2:soprano-bass:parallelOctaves',
      '2:tenor-bass:parallelFifths',
    ]);
  });
  it('finds a chordal seventh that rises instead of falling', () => {
    expect(summary('B4 D4 F3 G2\nC5 E4 G3 C3')).toEqual(['2:tenor:seventh']);
  });
  it('accepts the seventh when it falls by step', () => {
    expect(summary('B4 D4 F3 G2\nC5 E4 E3 C3')).toEqual([]);
  });
  it('reports voice crossing where the alto is above the soprano', () => {
    expect(summary('C4 E4 G3 C3')).toContain('1:soprano-alto:crossing');
  });
  it('passes a correct I–IV–V–I', () => {
    const text = 'E5 G4 E4 C3\nC5 A4 F4 F3\nB4 G4 D4 G3\nC5 G4 E4 C3';
    expect(summary(text)).toEqual([]);
    const report = chorale(text);
    expect(report.numerals).toEqual(['I', 'IV', 'V', 'I']);
    expect(report.cadence).toBe('perfectAuthentic');
  });
  it('flags a spacing, a range, and a doubled leading tone in the standard rules only', () => {
    expect(summary('C6 E4 G3 C3')).toEqual(expect.arrayContaining(['1:soprano:range', '1:soprano-alto:spacing']));
    expect(summary('C6 E4 G3 C3', 'relaxed')).toEqual([]);
    expect(summary('B4 B3 D3 G2')).toContain('1:soprano-alto:doubledLeadingTone');
  });
  it('flags a leading tone in the soprano that does not rise to the tonic', () => {
    expect(summary('B4 D4 G3 G2\nA4 E4 C4 C3')).toContain('2:soprano:leadingTone');
  });
  it('flags hidden octaves in the outer voices when the soprano leaps', () => {
    expect(summary('A4 F4 D4 B2\nD5 F4 A3 D3')).toContain('2:soprano-bass:directOctaves');
    expect(summary('C5 F4 A3 B2\nD5 F4 A3 D3')).not.toContain('2:soprano-bass:directOctaves');
  });
  it('flags an augmented second in one voice', () => {
    expect(summary('G4 E4 Ab3 C3\nG4 E4 B3 C3')).toContain('2:tenor:augmented');
  });
  it('flags a missing third', () => {
    expect(summary('C5 G4 G3 C3')).toContain('1::incomplete');
  });
  it('asks for leap recovery only in the strict rules', () => {
    const text = 'E5 C5 G4 C3\nE5 C5 A4 C3\nE5 C5 A4 C3\n';
    expect(summary(text, 'strict').filter((s) => s.endsWith('leapRecovery'))).toEqual([]);
    const leap = 'E5 C5 C4 C3\nE5 C5 G4 C3\nE5 C5 G4 C3\n';
    expect(summary(leap, 'strict')).toContain('2:tenor:leapRecovery');
    expect(summary(leap, 'standard')).not.toContain('2:tenor:leapRecovery');
  });
  it('names a half cadence and a deceptive cadence', () => {
    expect(chorale('E5 C5 G4 C3\nD5 B4 G4 G3').cadence).toBe('half');
    expect(chorale('D5 B4 G4 G3\nC5 E4 A3 A2').cadence).toBe('deceptive');
  });
});

describe('the chorale form', () => {
  it('reports a clean pass for the starting example, with a picture', () => {
    const result = run({});
    expect(wordOf(result, 'issuesOut')).toBe('cleanPass');
    expect(rowOf(result, 'numeralsOut')).toBe('I – IV – V – I');
    expect(result.ok && result.svg?.markup).toContain('<svg');
  });
  it('lists each problem with its chord', () => {
    const result = run({ chords: 'C5 E4 G3 C3\nD5 F4 A3 D3' });
    expect(rowOf(result, 'issuesOut')).toBe('2');
    expect(result.ok && result.rows.filter((r) => r.key === 'issueRow').map((r) => r.vars?.n)).toEqual(['2', '2']);
  });
  it.each([
    [{ chords: '' }, 'pwEmpty'],
    [{ chords: 'C5 E4 G3' }, 'pwChordCount'],
    [{ chords: 'C5 E4 G3 H3' }, 'pwChordNote'],
    [{ tonic: 'Z' }, 'pwTonicFormat'],
  ])('rejects %j as %s', (changes, error) => {
    const result = run(changes);
    expect(!result.ok && result.error).toBe(error);
  });
});

describe('species counterpoint', () => {
  const cantus = readNotes('C4 D4 E4 D4 C4')!;
  const issues = (line: string, species: 1 | 2 | 3 | 4 = 1, above = true) =>
    checkSpecies(cantus, readNotes(line)!, species, above).map((i) => `${i.measure}:${i.rule}`);
  it('passes a correct first-species line', () => {
    expect(issues('G4 F4 G4 B4 C5')).toEqual([]);
  });
  it('finds parallel fifths between strong beats', () => {
    expect(issues('G4 A4 G4 B4 C5')).toContain('2:parallelPerfect');
  });
  it('finds a dissonance on a strong beat', () => {
    expect(issues('G4 E4 G4 B4 C5')).toEqual(['2:dissonance']);
  });
  it('wants a perfect opening and an octave or unison ending', () => {
    expect(issues('E4 F4 G4 B4 C5')).toContain('1:opening');
    expect(issues('G4 F4 G4 B4 E5')).toContain('5:ending');
  });
  it('wants the last note approached by step as a major sixth above', () => {
    expect(issues('G4 F4 G4 A4 C5')).toContain('4:penultimate');
  });
  it('finds the voices crossing', () => {
    expect(issues('G4 F4 G4 B4 C5', 1, false)).toContain('1:crossing');
  });
  it('passes a correct second-species line and flags a weak dissonance entered by leap', () => {
    expect(issues('G4 E4 F4 A4 G4 B4 A4 B4 C5', 2)).toEqual([]);
    expect(issues('G4 E4 F4 E5 G4 B4 A4 B4 C5', 2)).toContain('2:unprepared');
  });
  it('accepts a prepared suspension in fourth species and rejects one that rises', () => {
    const ok = issues('G4 C5 C5 B4 B4 C5 C5 B4 C5', 4);
    expect(ok.filter((s) => s.endsWith('suspension'))).toEqual([]);
    expect(issues('G4 C5 C5 D5 B4 C5 C5 B4 C5', 4)).toContain('2:suspension');
  });
  it('reads the form and says how many notes the line needs', () => {
    const wrong = run({ mode: 'species', line: 'G4 F4' });
    expect(!wrong.ok && wrong.error).toBe('pwLineLength');
    expect(!wrong.ok && wrong.vars?.wanted).toBe('5');
    const right = run({ mode: 'species', species: '2', line: 'G4 E4 F4 A4 G4 B4 A4 B4 C5' });
    expect(wordOf(right, 'issuesOut')).toBe('cleanPass');
  });
});
