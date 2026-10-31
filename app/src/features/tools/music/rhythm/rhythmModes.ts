// The rhythm modes: Euclidean rhythms, rhythmic cycles, step patterns, polyrhythms, tempo in milliseconds with swing,
// and the metronome. Each can carry a sound plan for Play.
import { fail, fixed, fmt, ok, positive, readNumber, textTable } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import type { PlayNote, PlayPlan } from '../audio';
import {
  CYCLES,
  NOTE_VALUES,
  PATTERNS,
  bjorklund,
  cycleDiagram,
  gaps,
  msToHz,
  noteMs,
  parseSwing,
  polyrhythm,
  rotate,
  swungPair,
} from './rhythm';
import type { Cycle } from './rhythm';

const CLICK_HIGH = 1500;
const CLICK_MID = 1000;
const CLICK_LOW = 700;

function tempo(v: Values): number {
  const bpm = positive(v, 'bpm', 'rhyBpm');
  if (bpm < 20 || bpm > 400) fail('rhyBpmRange');
  return bpm;
}

/** A plan from a string of steps: 'x' hits, with the steps per beat saying how fast they come. */
function stepPlan(steps: string, perBeat: number, bpm: number, hz = CLICK_MID): PlayPlan {
  const notes: PlayNote[] = [...steps].flatMap((c, i) =>
    c === 'x'
      ? [{ at: i / perBeat, dur: 1 / perBeat, hz, level: (i === 0 ? 2 : 1) as 1 | 2, voice: 'click' as const }]
      : [],
  );
  return { notes, beats: steps.length / perBeat, bpm, loop: true, tempoField: 'bpm' };
}

const perBeat = (v: Values): number => Number(v.spb ?? '2');

export function euclid(v: Values): KitOk {
  const onsets = readNumber(v.onsets ?? '');
  const steps = readNumber(v.steps ?? '');
  const spin = readNumber(v.rotation ?? '0') ?? NaN;
  if (steps === null || !Number.isInteger(steps) || steps < 1 || steps > 64) return fail('rhyStepsRange');
  if (onsets === null || !Number.isInteger(onsets) || onsets < 0 || onsets > steps)
    return fail('rhyOnsetsRange', { steps: fmt(steps) });
  if (!Number.isInteger(spin)) return fail('rhyRotationWhole');
  const base = bjorklund(onsets, steps);
  const pattern = rotate(base, spin);
  const gap = onsets > 0 ? gaps(pattern) : [];
  const bpm = tempo(v);
  const rows: KitRow[] = [
    { key: 'patternOut', value: pattern },
    { key: 'gapsOut', value: gap.join(', ') || '' },
    { key: 'onsetCount', value: `${onsets} of ${steps}` },
  ];
  const steps2: KitStep[] = [
    { key: 'euclidSpread', vars: { k: fmt(onsets), n: fmt(steps) } },
    { key: 'euclidGaps', vars: { gaps: gap.join(', ') } },
    { key: 'euclidRotate', vars: { by: fmt(spin) } },
  ];
  return ok({
    rows,
    steps: steps2,
    answer: `E(${onsets}, ${steps}) = ${pattern}`,
    code: pattern,
    play: stepPlan(pattern, perBeat(v), bpm),
    notes: ['rhyNoteEuclid'],
  });
}

function cyclePlan(cycle: Cycle, bpm: number): PlayPlan {
  const notes: PlayNote[] = Array.from({ length: cycle.beats }, (_, i) => {
    const mark = cycle.marks[i + 1];
    const level = mark === 'sam' || mark === 'clap' ? 2 : mark === 'khali' || mark === 'wave' ? 0 : 1;
    return {
      at: i,
      dur: 1,
      hz: level === 2 ? CLICK_HIGH : level === 0 ? CLICK_LOW : CLICK_MID,
      level,
      voice: 'click' as const,
    };
  });
  return { notes, beats: cycle.beats, bpm, loop: true, tempoField: 'bpm' };
}

export function cycle(v: Values): KitOk {
  const found = CYCLES.find((c) => c.id === v.cycleId) ?? CYCLES[0]!;
  const bpm = tempo(v);
  const clap = Object.values(found.marks).filter((m) => m === 'sam' || m === 'tali' || m === 'clap').length;
  const rows: KitRow[] = [
    { key: 'cycleBeats', value: fmt(found.beats) },
    { key: 'cycleSections', value: found.sections.join(' + ') },
    { key: 'cycleLength', value: `${fixed((found.beats * 60) / bpm, 2)} s at ${fmt(bpm)} beats per minute` },
    { key: 'cycleMarked', value: fmt(clap) },
  ];
  return ok({
    rows,
    steps: [
      { key: 'cycleSplit', vars: { parts: found.sections.join(' + '), beats: fmt(found.beats) } },
      { key: found.family === 'hindustani' ? 'cycleSam' : 'cycleAdi' },
    ],
    answer: `${found.id}: ${found.beats} beats as ${found.sections.join(' + ')}`,
    code: cycleDiagram(found),
    play: cyclePlan(found, bpm),
    notes: found.family === 'hindustani' ? ['rhyNoteTala', 'rhyNoteMarks'] : ['rhyNoteAdi', 'rhyNoteMarks'],
  });
}

export function pattern(v: Values): KitOk {
  const found = PATTERNS.find((p) => p.id === v.patternId) ?? PATTERNS[0]!;
  const bpm = tempo(v);
  const dots = [...found.steps].map((c) => (c === 'D' || c === 'T' ? 'x' : c)).join('');
  const hits = [...dots].filter((c) => c === 'x').length;
  const notes: PlayNote[] =
    found.family === 'arabic'
      ? [...found.steps].flatMap((c, i) =>
          c === '.'
            ? []
            : [
                {
                  at: i / perBeat(v),
                  dur: 1 / perBeat(v),
                  hz: c === 'D' ? 220 : 880,
                  level: (c === 'D' ? 2 : 1) as 1 | 2,
                  voice: 'click' as const,
                },
              ],
        )
      : stepPlan(dots, perBeat(v), bpm).notes;
  return ok({
    rows: [
      { key: 'patternOut', value: found.steps },
      { key: 'stepCount', value: fmt(found.steps.length) },
      { key: 'onsetCount', value: `${hits} of ${found.steps.length}` },
      { key: 'gapsOut', value: gaps(dots).join(', ') },
    ],
    steps: [
      { key: found.family === 'clave' ? 'patternClave' : 'patternArabic' },
      { key: 'patternGaps', vars: { gaps: gaps(dots).join(', ') } },
    ],
    answer: `${found.id}: ${found.steps}`,
    code: found.steps,
    play: { notes, beats: found.steps.length / perBeat(v), bpm, loop: true, tempoField: 'bpm' },
    notes: [found.family === 'clave' ? 'rhyNoteClave' : 'rhyNoteArabic'],
  });
}

export function poly(v: Values): KitOk {
  const m = readNumber(v.polyA ?? '');
  const n = readNumber(v.polyB ?? '');
  const whole = (x: number | null): x is number => x !== null && Number.isInteger(x) && x >= 1 && x <= 16;
  if (!whole(m) || !whole(n)) return fail('rhyPolyRange');
  const grid = polyrhythm(m, n);
  const bpm = tempo(v);
  const per = perBeat(v);
  const hit = (pattern: string, hz: number, level: 1 | 2): PlayNote[] =>
    [...pattern].flatMap((c, i) =>
      c === 'x'
        ? [{ at: i / per, dur: 1 / per, hz, level: i === 0 ? (2 as const) : level, voice: 'click' as const }]
        : [],
    );
  const notes = [...hit(grid.first, CLICK_MID, 1), ...hit(grid.second, CLICK_LOW, 1)].sort((a, b) => a.at - b.at);
  return ok({
    rows: [
      { key: 'gridLength', value: fmt(grid.length) },
      { key: 'firstVoice', value: grid.first },
      { key: 'secondVoice', value: grid.second },
    ],
    steps: [
      { key: 'polyLcm', vars: { m: fmt(m), n: fmt(n), len: fmt(grid.length) } },
      { key: 'polyEvery', vars: { a: fmt(grid.length / m), b: fmt(grid.length / n) } },
    ],
    answer: `${m}:${n} on a ${grid.length} step grid`,
    code: `${m}: ${[...grid.first].join(' ')}\n${n}: ${[...grid.second].join(' ')}`,
    play: { notes, beats: grid.length / per, bpm, loop: true, tempoField: 'bpm' },
    notes: ['rhyNotePoly'],
  });
}

export function tempoMode(v: Values): KitOk {
  const bpm = tempo(v);
  const ratio = parseSwing(v.swing ?? '');
  if (ratio === null) fail('rhySwingFormat');
  const lines = textTable(
    [
      ['Note', 'Plain', 'Dotted', 'Triplet', 'Hz'],
      ...NOTE_VALUES.map((nv) => [
        nv.id,
        fixed(noteMs(bpm, nv.beats), 2),
        fixed(noteMs(bpm, nv.beats, 'dotted'), 2),
        fixed(noteMs(bpm, nv.beats, 'triplet'), 2),
        fixed(msToHz(noteMs(bpm, nv.beats)), 3),
      ]),
    ],
    [14, 10, 10, 10, 9],
  );
  const [long, short] = swungPair(bpm, ratio ?? 1);
  return ok({
    rows: [
      { key: 'quarterMs', value: `${fixed(noteMs(bpm, 1), 2)} ms` },
      { key: 'dottedEighthMs', value: `${fixed(noteMs(bpm, 0.5, 'dotted'), 2)} ms` },
      { key: 'swingLong', value: `${fixed(long, 2)} ms` },
      { key: 'swingShort', value: `${fixed(short, 2)} ms` },
    ],
    steps: [
      { key: 'tempoQuarter', vars: { bpm: fmt(bpm), ms: fixed(noteMs(bpm, 1), 2) } },
      { key: 'tempoDotted' },
      { key: 'tempoSwing', vars: { ratio: fmt(ratio ?? 1, 4), long: fixed(long, 2), short: fixed(short, 2) } },
    ],
    answer:
      `At ${fmt(bpm)} BPM a quarter note is ${fixed(noteMs(bpm, 1), 1)} ms ` +
      `and a dotted eighth is ${fixed(noteMs(bpm, 0.5, 'dotted'), 1)} ms`,
    code: lines,
    notes: ['rhyNoteTempo'],
  });
}

export function metronome(v: Values): KitOk {
  const bpm = tempo(v);
  const bar = readNumber(v.bar ?? '');
  if (bar === null || !Number.isInteger(bar) || bar < 1 || bar > 16) return fail('rhyBarRange');
  const sub = Number(v.sub ?? '1');
  const notes: PlayNote[] = [];
  for (let beat = 0; beat < bar; beat++) {
    for (let j = 0; j < sub; j++) {
      const main = j === 0;
      const accented = main && beat === 0 && v.accent !== 'none';
      notes.push({
        at: beat + j / sub,
        dur: 1 / sub,
        hz: accented ? CLICK_HIGH : main ? CLICK_MID : CLICK_LOW,
        level: accented ? 2 : main ? 1 : 0,
        voice: 'click',
      });
    }
  }
  return ok({
    rows: [
      { key: 'beatMs', value: `${fixed(60000 / bpm, 2)} ms` },
      { key: 'barSeconds', value: `${fixed((bar * 60) / bpm, 3)} s` },
      { key: 'clicksPerBar', value: fmt(notes.length) },
    ],
    steps: [
      { key: 'metroBeat', vars: { bpm: fmt(bpm), ms: fixed(60000 / bpm, 2) } },
      { key: 'metroBar', vars: { bar: fmt(bar), sub: fmt(sub) } },
    ],
    answer: `${fmt(bpm)} BPM, ${bar} beats to the bar`,
    play: { notes, beats: bar, bpm, loop: true, tempoField: 'bpm' },
    notes: ['rhyNoteMetronome'],
  });
}
