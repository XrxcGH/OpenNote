// The ear-training modes: one drill item with its answer checked, or a session of answers graded together with the weak
// items scheduled for review by the study deck's scheduler.
import { parseSeed } from '../../subjects/num/rng';
import { nextState } from '../../../study';
import { fail, ok, readNumber } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import { hzOf, intervalWords, noteName, pitchClassName, transposeNote } from '../theory/notes';
import {
  chordMembers,
  intervalName,
  itemAt,
  noteMatches,
  readChordAnswer,
  readIntervalAnswer,
  readNoteList,
  readScaleAnswer,
  scaleName,
  spelled,
  syllable,
} from './engine';
import type { DrillKind, Item, Settings } from './engine';
import { scaleDef, scaleSemitones } from '../theory/scales';
import { quality } from '../theory/chords';

const KINDS: readonly DrillKind[] = ['interval', 'chord', 'scale', 'melody', 'rhythm', 'sing'];

function settingsOf(v: Values): Settings {
  const level = v.level === 'hard' ? 'hard' : v.level === 'medium' ? 'medium' : 'easy';
  const range = v.range === 'low' ? 'low' : v.range === 'high' ? 'high' : 'mid';
  const delivery = v.delivery === 'down' ? 'down' : v.delivery === 'together' ? 'together' : 'up';
  const length = readNumber(v.length ?? '4');
  if (length === null || !Number.isInteger(length) || length < 3 || length > 8) return fail('earLengthRange');
  const bpm = readNumber(v.bpm ?? '80');
  if (bpm === null || bpm < 40 || bpm > 200) return fail('earBpmRange');
  return { level, range, delivery, length, bpm };
}

function seedOf(v: Values): bigint {
  return parseSeed(v.seed ?? '') ?? fail('earSeedFormat');
}

export interface Grade {
  correct: boolean;
  rightAnswer: string;
  rows: KitRow[];
  steps: KitStep[];
  yours: string;
}

/** Grades a typed answer to an item. A problem with the typed answer (not an unknown word) throws. */
export function grade(item: Item, answer: string): Grade {
  const rows: KitRow[] = [];
  switch (item.kind) {
    case 'interval': {
      const semis = readIntervalAnswer(answer);
      if (semis === null) return fail('earIntervalFormat');
      const first = item.root;
      const second = item.delivery === 'down' ? transposeNote(first, item.interval, true) : transposeNote(first, item.interval);
      return {
        correct: semis === item.interval.semitones,
        rightAnswer: intervalName(item.interval),
        yours: answer,
        rows,
        steps: [
          { key: 'earStepInterval', vars: { from: noteName(first), to: noteName(second), generic: String(item.interval.generic), semis: String(item.interval.semitones), name: intervalWords(item.interval) } },
        ],
      };
    }
    case 'chord': {
      const id = readChordAnswer(answer);
      if (id === null) return fail('earChordFormat');
      return {
        correct: id === item.qualityId,
        rightAnswer: quality(item.qualityId).symbols[0] === '' ? 'major' : `${pitchClassName(item.root)}${quality(item.qualityId).symbols[0]}`,
        yours: answer,
        rows,
        steps: [{ key: 'earStepChord', vars: { chord: `${pitchClassName(item.root)}${quality(item.qualityId).symbols[0]}`, members: chordMembers(item.root, item.qualityId) } }],
      };
    }
    case 'scale': {
      const id = readScaleAnswer(answer);
      if (id === null) return fail('earScaleFormat');
      return {
        correct: id === item.scaleId,
        rightAnswer: scaleName(item.scaleId),
        yours: answer,
        rows,
        steps: [
          { key: 'earStepScale', vars: { name: scaleName(item.scaleId), degrees: scaleDef(item.scaleId).degrees, steps: scaleSemitones(scaleDef(item.scaleId).degrees).join(' ') } },
        ],
      };
    }
    case 'melody': {
      const typed = readNoteList(answer);
      if (typed === null) return fail('earMelodyFormat');
      let all = true;
      item.notes.forEach((target, i) => {
        const t = typed[i];
        const right = t !== undefined && noteMatches(t, target);
        if (!right) all = false;
        rows.push({
          key: 'noteRow',
          vars: { n: String(i + 1) },
          value: right
            ? 'correct'
            : t === undefined
              ? `missing: the note is ${pitchClassName(target)}`
              : `wrong: ${pitchClassName(t)} for ${pitchClassName(target)}`,
        });
      });
      return {
        correct: all,
        rightAnswer: item.notes.map(pitchClassName).join(' '),
        yours: answer,
        rows,
        steps: [{ key: 'earStepMelody', vars: { notes: item.notes.map(pitchClassName).join(' '), degrees: item.degrees.map((d) => d + 1).join(' ') } }],
      };
    }
    case 'rhythm': {
      const typed = answer.trim().toLowerCase().replace(/[\s|]+/g, '').replace(/[-_]/g, '.');
      if (!/^[x.]+$/.test(typed)) return fail('earRhythmFormat');
      let all = typed.length === item.steps.length;
      [...item.steps].forEach((c, i) => {
        const right = typed[i] === c;
        if (!right) all = false;
        if (!right) rows.push({ key: 'stepRow', vars: { n: String(i + 1) }, value: `wrong: ${typed[i] ?? 'missing'}, it is ${c}` });
      });
      return {
        correct: all,
        rightAnswer: item.steps,
        yours: typed,
        rows,
        steps: [{ key: 'earStepRhythm', vars: { steps: item.steps } }],
      };
    }
    case 'sing':
      return fail('earNoGrade');
  }
}

export function drill(kind: DrillKind) {
  return (v: Values): KitOk => {
    const settings = settingsOf(v);
    const seed = seedOf(v);
    const n = readNumber(v.item ?? '1');
    if (n === null || !Number.isInteger(n) || n < 1 || n > 200) return fail('earItemRange');
    const item = itemAt(kind, seed, settings, n);
    const header: KitRow = { key: 'itemOut', value: `${n}`, vars: { kind: kind } };
    const answer = (v.answer ?? '').trim();
    if (kind === 'sing') {
      const base = v.solfege === 'do' ? 'do' : 'la';
      if (item.kind !== 'sing') return fail('earNoGrade');
      const syllables = item.degrees.map((d) => syllable(d, item.minor, base));
      return ok({
        rows: [
          header,
          { key: 'keyOut', value: `${pitchClassName(item.tonic)} ${item.minor ? 'minor' : 'major'}` },
          { key: 'notesOut', value: spelled(item.notes) },
          { key: 'solfegeOut', value: syllables.join(' ') },
          { key: 'referenceOut', value: `${noteName(item.tonic)} (${hzOf(item.tonic).toFixed(1)} Hz)` },
        ],
        steps: [{ key: 'earStepSing', vars: { syllables: item.minor ? (base === 'la' ? 'la-based minor' : 'do-based minor') : 'movable do' } }],
        answer: `${syllables.join(' ')} in ${pitchClassName(item.tonic)} ${item.minor ? 'minor' : 'major'}`,
        play: item.plan,
        notes: ['earNoteSing'],
      });
    }
    if (answer === '') {
      return ok({
        rows: [header, { key: 'promptOut', value: '', word: 'promptListen' }],
        steps: [{ key: 'earStepListen' }],
        answer: `Ear training ${kind}, item ${n}, seed ${seed}.`,
        play: item.plan,
        notes: ['earNoteSeed'],
      });
    }
    const result = grade(item, answer);
    return ok({
      rows: [
        header,
        { key: 'resultOut', value: '', word: result.correct ? 'resultCorrect' : 'resultWrong' },
        { key: 'rightOut', value: result.rightAnswer },
        ...result.rows,
      ],
      steps: result.steps,
      answer: `${kind} item ${n}: ${result.correct ? 'correct' : `wrong (answered ${result.yours}, right answer ${result.rightAnswer})`}`,
      play: item.plan,
      notes: ['earNoteSeed'],
    });
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A session: the answers typed one to a line are graded against items 1 to k, and the weak items are scheduled. */
export function session(kind: DrillKind) {
  return (v: Values): KitOk => {
    if (kind === 'sing') return fail('earNoGrade');
    const settings = settingsOf(v);
    const seed = seedOf(v);
    const today = (v.today ?? '').trim();
    if (!DATE.test(today)) return fail('earDateFormat');
    const lines = (v.answers ?? '').split('\n').map((l) => l.trim());
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    if (lines.length === 0) return fail('earNoAnswers');
    if (lines.length > 50) return fail('earTooManyAnswers');
    const rows: KitRow[] = [];
    const weak: number[] = [];
    let right = 0;
    lines.forEach((line, i) => {
      const item = itemAt(kind, seed, settings, i + 1);
      let g: Grade | null = null;
      if (line !== '') {
        try {
          g = grade(item, line);
        } catch {
          g = null;
        }
      }
      const correct = g?.correct === true;
      if (correct) right++;
      else weak.push(i + 1);
      const state = nextState(undefined, correct ? 'good' : 'again', today);
      const expected = g?.rightAnswer ?? grade(item, defaultAnswer(item)).rightAnswer;
      rows.push({
        key: 'sessionRow',
        vars: { n: String(i + 1) },
        value: correct
          ? `correct; next review ${state.due}`
          : `${line === '' ? 'no answer' : g ? `wrong, you wrote ${line}` : `not understood: ${line}`}; the answer is ${expected}; review ${state.due}`,
      });
    });
    return ok({
      rows: [
        { key: 'scoreOut', value: `${right} of ${lines.length}` },
        { key: 'weakOut', value: weak.length > 0 ? weak.join(', ') : 'none' },
        ...rows,
      ],
      steps: [{ key: 'earStepSession' }, { key: 'earStepSchedule' }],
      answer: `${right} of ${lines.length} correct${weak.length > 0 ? `; review items ${weak.join(', ')}` : ''}`,
      notes: ['earNoteSeed', 'earNoteSchedule'],
    });
  };
}

/** Something that grades as wrong against every item, only to read the right answer back. */
function defaultAnswer(item: Item): string {
  switch (item.kind) {
    case 'interval':
      return 'tritone';
    case 'chord':
      return 'major';
    case 'scale':
      return 'major';
    case 'melody':
      return 'C';
    default:
      return 'x';
  }
}

export const runDrill = (v: Values): KitOk => {
  const kind = KINDS.includes(v.mode as DrillKind) ? (v.mode as DrillKind) : 'interval';
  return v.run === 'session' ? session(kind)(v) : drill(kind)(v);
};
