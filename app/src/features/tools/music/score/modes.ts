// The score block's modes: read ABC and engrave it with a check of the bars, transpose it by an interval, to a key, or
// for an instrument, and show it in numbered, sargam, or tablature notation.
import { fail, fmt, ok } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import type { PlayNote, PlayPlan } from '../audio';
import { hzOf, midiOf, noteName, parseInterval, pitchClassName } from '../theory/notes';
import { midiToHz } from '../pitch';
import { AbcError, checkBars, countBars, countNotes, parseAbc, timeline, writeAbc } from './abc';
import type { Tune, Voice } from './abc';
import { scorePicture } from './picture';
import { forInstrument, jianpu, sargam, tablature, transposeBy, transposeToKey } from './views';
import { instrument } from '../theory/practice';

const MAX_CHARS = 20_000;
const MAX_NOTES = 2_000;

function readTune(v: Values): Tune {
  const text = v.abc ?? '';
  if (text.trim() === '') return fail('scoreEmpty');
  if (text.length > MAX_CHARS) return fail('scoreTooLong');
  try {
    const tune = parseAbc(text);
    if (tune.voices.reduce((s, x) => s + countNotes(x), 0) > MAX_NOTES) return fail('scoreTooLong');
    return tune;
  } catch (error) {
    if (!(error instanceof AbcError)) throw error;
    switch (error.code) {
      case 'empty':
        return fail('scoreEmpty');
      case 'noKey':
        return fail('scoreNoKey');
      case 'char':
        return fail('scoreChar', { char: error.detail, line: String(error.line) });
      case 'meter':
        return fail('scoreMeter', { text: error.detail, line: String(error.line) });
      case 'length':
        return fail('scoreLength', { text: error.detail, line: String(error.line) });
      case 'key':
        return fail('scoreKey', { text: error.detail, line: String(error.line) });
      case 'chord':
        return fail('scoreChord', { line: String(error.line) });
      default:
        return fail('scoreTuplet', { line: String(error.line) });
    }
  }
}

function chosen(tune: Tune, v: Values): Voice[] {
  const id = (v.voice ?? '').trim();
  if (id === '') return tune.voices;
  const voice = tune.voices.find((x) => x.id === id);
  return voice ? [voice] : fail('scoreVoiceUnknown', { id, ids: tune.voices.map((x) => x.id).join(', ') });
}

function planOf(tune: Tune, voices: readonly Voice[]): PlayPlan {
  const notes: PlayNote[] = [];
  let beats = 0;
  for (const voice of voices) {
    for (const t of timeline(voice)) {
      beats = Math.max(beats, t.at + t.dur);
      for (const midi of t.midi) notes.push({ at: t.at, dur: t.dur, hz: midiToHz(midi), level: 1, voice: 'tone' });
    }
  }
  return { notes, beats, bpm: Math.min(300, Math.max(30, tune.bpm)), loop: false };
}

const keyName = (tune: Tune): string => `${pitchClassName(tune.key.tonic)} ${tune.key.mode}`;
const meterText = (tune: Tune): string => `${tune.meter.num}/${tune.meter.den}`;
const noteList = (voice: Voice): string =>
  voice.items.flatMap((i) => (i.kind === 'note' ? [i.pitches.map(noteName).join('+')] : [])).join(' ');

export function engrave(v: Values): KitOk {
  const tune = readTune(v);
  const voices = chosen(tune, v);
  const checks = checkBars(tune).filter((c) => voices.some((x) => x.id === c.voice));
  const notes = voices.reduce((s, x) => s + countNotes(x), 0);
  const bars = Math.max(...voices.map(countBars));
  const rows: KitRow[] = [
    { key: 'tuneKey', value: keyName(tune) },
    { key: 'tuneMeter', value: meterText(tune) },
    { key: 'tuneTempo', value: fmt(tune.bpm, 4) },
    { key: 'tuneNotes', value: String(notes) },
    { key: 'tuneBars', value: String(bars) },
    { key: 'tuneNoteNames', value: noteList(voices[0]!) },
  ];
  for (const c of checks) {
    rows.push({
      key: 'barWarn',
      vars: { n: String(c.bar) },
      value: `${tune.voices.length > 1 ? `voice ${c.voice}: ` : ''}${fmt(c.length * tune.meter.den, 4)} of ${tune.meter.num} beats`,
    });
  }
  const label = `${tune.title || 'Tune'}: ${notes} notes in ${bars} bar${bars === 1 ? '' : 's'} in ${keyName(tune)}, ${meterText(tune)}`;
  return ok({
    rows,
    steps: [
      { key: 'scoreStepRead', vars: { unit: `1/${Math.round(1 / tune.unit)}` } },
      { key: 'scoreStepBars', vars: { meter: meterText(tune) } },
      { key: 'scoreStepSound' },
    ],
    answer: label,
    svg: { markup: scorePicture(tune, voices, label), label },
    code: v.abc!.trim(),
    play: planOf(tune, voices),
    notes: ['scoreNoteSubset', 'scoreNoteMidi'],
  });
}

function transposed(tune: Tune, v: Values): { result: Tune; steps: KitStep[]; label: string } {
  const toKey = (v.toKey ?? '').trim();
  const steps: KitStep[] = [];
  if (toKey !== '') {
    const moved = transposeToKey(tune, toKey);
    if (!moved) return fail('scoreToKeyFormat');
    steps.push({
      key: 'scoreStepToKey',
      vars: { from: keyName(tune), semis: String(moved.interval.semitones), dir: moved.down ? 'down' : 'up' },
    });
    return { result: moved.tune, steps, label: `to ${toKey}` };
  }
  const interval = parseInterval(v.interval ?? '') ?? fail('scoreIntervalFormat');
  const down = v.direction === 'down';
  try {
    steps.push({ key: 'scoreStepInterval', vars: { semis: String(interval.semitones), dir: down ? 'down' : 'up' } });
    return { result: transposeBy(tune, interval, down), steps, label: `${v.interval} ${down ? 'down' : 'up'}` };
  } catch (error) {
    if (error instanceof AbcError) return fail('scoreKeyTooFar');
    throw error;
  }
}

export function transpose(v: Values): KitOk {
  const tune = readTune(v);
  const voices = chosen(tune, v);
  const { result, steps, label } = transposed(tune, v);
  const part = result.voices.filter((x) => voices.some((y) => y.id === x.id));
  const text = writeAbc({ ...result, voices: part });
  return ok({
    rows: [
      { key: 'tuneKey', value: keyName(result) },
      { key: 'tuneNoteNames', value: noteList(part[0]!) },
      { key: 'abcOut', value: text.split('\n').pop() ?? '' },
    ],
    steps: [...steps, { key: 'scoreStepSpell' }],
    answer: `${tune.title || 'Tune'} ${label}: key ${keyName(result)}`,
    svg: { markup: scorePicture(result, part, `Transposed ${label}`), label: `Transposed ${label}` },
    code: text,
    play: planOf(result, part),
    notes: ['scoreNoteSubset'],
  });
}

export function forPlayer(v: Values): KitOk {
  const tune = readTune(v);
  const voices = chosen(tune, v);
  const inst = instrument(v.instrumentId ?? 'clarinetBb');
  let result: Tune;
  try {
    result = forInstrument(tune, inst.id);
  } catch (error) {
    if (error instanceof AbcError) return fail('scoreKeyTooFar');
    throw error;
  }
  const part = result.voices.filter((x) => voices.some((y) => y.id === x.id));
  const text = writeAbc({ ...result, voices: part });
  return ok({
    rows: [
      { key: 'instOut', value: inst.name },
      { key: 'tuneKey', value: keyName(result) },
      { key: 'tuneNoteNames', value: noteList(part[0]!) },
    ],
    steps: [{ key: 'scoreStepInstrument', vars: { inst: inst.name, key: keyName(result) } }],
    answer: `Part for ${inst.name}, key ${keyName(result)}`,
    svg: { markup: scorePicture(result, part, `Part for ${inst.name}`), label: `Part for ${inst.name}` },
    code: text,
    notes: ['scoreNoteInstrument'],
  });
}

export function numbered(v: Values): KitOk {
  const tune = readTune(v);
  const voices = chosen(tune, v);
  const lines = voices.map((voice) => ({ id: voice.id, ...jianpu(voice, tune.key) }));
  return ok({
    rows: lines.flatMap((l) => [
      { key: 'jianpuPlain' as const, vars: { voice: l.id }, value: l.plain },
      { key: 'jianpuTimed' as const, vars: { voice: l.id }, value: l.timed },
    ]),
    steps: [{ key: 'scoreStepJianpu', vars: { key: keyName(tune) } }, { key: 'scoreStepJianpuMarks' }],
    answer: lines.map((l) => l.plain).join(' / '),
    notes: ['scoreNoteJianpu'],
  });
}

export function indian(v: Values): KitOk {
  const tune = readTune(v);
  const voices = chosen(tune, v);
  const lines = voices.map((voice) => ({ id: voice.id, text: sargam(voice, tune.key) }));
  return ok({
    rows: lines.map((l) => ({ key: 'sargamRow' as const, vars: { voice: l.id }, value: l.text })),
    steps: [
      { key: 'scoreStepSargam', vars: { tonic: pitchClassName(tune.key.tonic) } },
      { key: 'scoreStepSargamMarks' },
    ],
    answer: lines.map((l) => l.text).join(' / '),
    notes: ['scoreNoteSargam'],
  });
}

export function guitarTab(v: Values): KitOk {
  const tune = readTune(v);
  const voices = chosen(tune, v);
  const results = voices.map((voice) => ({ id: voice.id, ...tablature(voice) }));
  const bad = results.find((r) => r.bad);
  if (bad?.bad)
    return fail('scoreTabRange', { note: noteName(bad.bad), hz: fmt(hzOf(bad.bad), 4), midi: String(midiOf(bad.bad)) });
  return ok({
    rows: results.map((r) => ({ key: 'tabRow' as const, vars: { voice: r.id }, value: r.text })),
    steps: [{ key: 'scoreStepTab' }, { key: 'scoreStepTabSpan' }],
    answer: results.map((r) => r.text).join(' / '),
    code: results.map((r) => r.staff).join('\n\n'),
    notes: ['scoreNoteTab'],
  });
}
