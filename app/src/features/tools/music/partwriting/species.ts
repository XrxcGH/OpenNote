// Two-voice species counterpoint, first to fourth species, against a cantus firmus. The rules are the ones taught with
// Fux's method; textbooks differ in the small print, so the checks stay to the rules most of them share.
import { between, midiOf, parseNote } from '../theory/notes';
import type { Note } from '../theory/notes';

export type SpeciesRule =
  | 'opening'
  | 'ending'
  | 'penultimate'
  | 'dissonance'
  | 'unprepared'
  | 'parallelPerfect'
  | 'directPerfect'
  | 'parallelImperfect'
  | 'crossing'
  | 'climax'
  | 'leap'
  | 'suspension';

export const SPECIES_TEXT: Record<SpeciesRule, string> = {
  opening: 'should begin on a perfect consonance',
  ending: 'should end on a unison or an octave',
  penultimate: 'should approach the last note by step, as a major sixth (above) or minor third (below) over the cantus',
  dissonance: 'dissonance on a strong beat',
  unprepared: 'dissonance on a weak beat must be passed through by step',
  parallelPerfect: 'parallel fifths or octaves between strong beats',
  directPerfect: 'perfect consonance reached by similar motion',
  parallelImperfect: 'more than three parallel thirds or sixths in a row',
  crossing: 'the voices cross',
  climax: 'the highest note appears more than once',
  leap: 'leap larger than an octave',
  suspension: 'a suspended dissonance must fall by step to a consonance',
};

export interface SpeciesIssue {
  /** The 1-based measure (one note of the cantus firmus). */
  measure: number;
  rule: SpeciesRule;
}

export type Species = 1 | 2 | 3 | 4;

/** Notes against each cantus note in a species, before the last measure's single note. */
export const PER_MEASURE: Record<Species, number> = { 1: 1, 2: 2, 3: 4, 4: 2 };

/** How many notes the counterpoint should have for a cantus firmus of this length. */
export const expectedLength = (cantus: number, species: Species): number => PER_MEASURE[species] * (cantus - 1) + 1;

export function readNotes(text: string): Note[] | null {
  const tokens = text.split(/[\s,|]+/).filter(Boolean);
  const notes = tokens.map((t) => parseNote(t));
  return tokens.length === 0 || notes.some((n) => n === null) ? null : (notes as Note[]);
}

const sem = (n: Note): number => midiOf(n);
const CONSONANT = new Set([0, 3, 4, 7, 8, 9]);
const PERFECT = new Set([0, 7]);
const mod = (n: number): number => ((Math.abs(n) % 12) + 12) % 12;

/** The size of the interval between the two voices in semitones, measured from whichever is lower. */
const gap = (a: Note, b: Note): number => Math.abs(sem(a) - sem(b));
const isConsonant = (a: Note, b: Note): boolean => CONSONANT.has(mod(gap(a, b)));
const isPerfect = (a: Note, b: Note): boolean => PERFECT.has(mod(gap(a, b)));
const isStep = (a: Note, b: Note): boolean => {
  const d = Math.abs(sem(a) - sem(b));
  return d >= 1 && d <= 2 && Math.abs(between(a, b).interval.generic) === 2;
};

export function checkSpecies(cantus: readonly Note[], line: readonly Note[], species: Species, above: boolean): SpeciesIssue[] {
  const issues: SpeciesIssue[] = [];
  const add = (measure: number, rule: SpeciesRule): void => {
    if (!issues.some((i) => i.measure === measure && i.rule === rule)) issues.push({ measure, rule });
  };
  const per = PER_MEASURE[species];
  const n = cantus.length;
  const at = (m: number, beat = 0): Note => line[m * per + beat]!;

  // Opening and ending.
  const first = gap(cantus[0]!, at(0));
  if (!(above ? PERFECT.has(mod(first)) : mod(first) === 0)) add(1, 'opening');
  const final = gap(cantus[n - 1]!, at(n - 1));
  if (mod(final) !== 0) add(n, 'ending');
  const lastBefore = line[line.length - 2];
  if (n >= 2 && lastBefore) {
    const approach = species === 1 ? at(n - 2) : lastBefore;
    const stepwise = isStep(approach, at(n - 1));
    const sixthOrThird = species === 1 ? mod(gap(cantus[n - 2]!, approach)) === (above ? 9 : 3) : true;
    if (!stepwise || !sixthOrThird) add(n - 1, 'penultimate');
  }

  // Strong beats must be consonant, except a suspension in the fourth species.
  for (let m = 0; m < n; m++) {
    const suspension = species === 4 && m > 0 && m < n - 1;
    for (const beat of species === 3 && m < n - 1 ? [0, 2] : [0]) {
      if (!suspension && !isConsonant(cantus[m]!, at(m, beat))) add(m + 1, 'dissonance');
    }
    const lower = above ? cantus[m]! : at(m);
    const upper = above ? at(m) : cantus[m]!;
    if (sem(lower) > sem(upper)) add(m + 1, 'crossing');
  }
  if (species === 4) {
    // The strong-beat note is the previous weak note held over the barline. A dissonant one is a suspension: it must fall
    // by step (rise, with the line below) to a consonance on the weak beat.
    for (let m = 1; m < n - 1; m++) {
      if (isConsonant(cantus[m]!, at(m))) continue;
      const resolution = at(m, 1);
      const stepFrom = above ? sem(at(m)) - sem(resolution) : sem(resolution) - sem(at(m));
      if (!(stepFrom >= 1 && stepFrom <= 2 && isConsonant(cantus[m]!, resolution))) add(m + 1, 'suspension');
    }
  }
  for (let m = 0; m < n - 1; m++) {
    const a = gap(cantus[m]!, at(m));
    const b = gap(cantus[m + 1]!, at(m + 1));
    const moveCantus = Math.sign(sem(cantus[m + 1]!) - sem(cantus[m]!));
    const moveLine = Math.sign(sem(at(m + 1)) - sem(at(m)));
    if (PERFECT.has(mod(b)) && moveCantus !== 0 && moveCantus === moveLine) {
      if (PERFECT.has(mod(a)) && mod(a) === mod(b)) add(m + 2, 'parallelPerfect');
      else if (species === 1 || m + 1 === n - 1) {
        // Similar motion into a perfect consonance is only forgiven when the upper voice steps and the last measure is
        // approached by step.
        const upperVoiceStep = above ? isStep(at(m), at(m + 1)) : isStep(cantus[m]!, cantus[m + 1]!);
        if (!upperVoiceStep) add(m + 2, 'directPerfect');
      }
    }
  }

  // Weak beats: a dissonance must be passed through by step (species 3 also allows a neighbor note).
  if (species === 2 || species === 3) {
    for (let m = 0; m < n - 1; m++) {
      for (let beat = 1; beat < per; beat++) {
        if (species === 3 && beat === 2) continue;
        const note = at(m, beat);
        if (isConsonant(cantus[m]!, note)) continue;
        const prev = line[m * per + beat - 1]!;
        const next = line[m * per + beat + 1]!;
        const passing = isStep(prev, note) && isStep(note, next) && Math.sign(sem(note) - sem(prev)) === Math.sign(sem(next) - sem(note));
        const neighbor = species === 3 && isStep(prev, note) && isStep(note, next) && sem(prev) === sem(next);
        if (!passing && !neighbor) add(m + 1, 'unprepared');
      }
    }
  }

  // Parallel imperfect consonances: more than three thirds or sixths in a row between strong beats.
  let run = 1;
  for (let m = 1; m < n; m++) {
    const imperfect = (k: number): boolean => [3, 4, 8, 9].includes(mod(gap(cantus[k]!, at(k))));
    const same = Math.sign(sem(cantus[m]!) - sem(cantus[m - 1]!)) === Math.sign(sem(at(m)) - sem(at(m - 1)));
    run = imperfect(m) && imperfect(m - 1) && same ? run + 1 : 1;
    if (run > 3) add(m + 1, 'parallelImperfect');
  }

  // The line's highest note appears once, and no leap is bigger than an octave.
  const top = Math.max(...line.map(sem));
  const climaxes = line.filter((x) => sem(x) === top);
  if (climaxes.length > 1 && line.length > 2) add(Math.floor(line.indexOf(climaxes[1]!) / per) + 1, 'climax');
  for (let i = 1; i < line.length; i++) {
    if (Math.abs(sem(line[i]!) - sem(line[i - 1]!)) > 12) add(Math.floor(i / per) + 1, 'leap');
  }
  return issues.sort((x, y) => x.measure - y.measure);
}
