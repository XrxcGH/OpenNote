// The voice-leading checker's modes: four-part chorale writing, and two-voice species counterpoint.
import { fail, ok } from '../shared';
import type { KitOk, KitRow, Values } from '../shared';
import { parsePitchClass, pitchClassName } from '../theory/notes';
import { VOICES, RULE_TEXT, checkChorale, readChords } from './chorale';
import type { Strictness } from './chorale';
import { chordPicture } from './picture';
import { PER_MEASURE, SPECIES_TEXT, checkSpecies, expectedLength, readNotes } from './species';
import type { Species } from './species';

const CADENCE_WORDS = {
  perfectAuthentic: 'cadencePerfect',
  authentic: 'cadenceAuthentic',
  plagal: 'cadencePlagal',
  deceptive: 'cadenceDeceptive',
  half: 'cadenceHalf',
  none: 'cadenceNone',
} as const;

const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function choraleMode(v: Values): KitOk {
  const tonic = parsePitchClass(v.tonic ?? '') ?? fail('pwTonicFormat');
  const mode = v.keyMode === 'minor' ? 'minor' : 'major';
  const level: Strictness = v.strictness === 'strict' ? 'strict' : v.strictness === 'relaxed' ? 'relaxed' : 'standard';
  const text = v.chords ?? '';
  if (text.trim() === '') return fail('pwEmpty');
  const read = readChords(text);
  if (!('chords' in read)) return fail(read.reason === 'count' ? 'pwChordCount' : 'pwChordNote', { line: String(read.line) });
  if (read.chords.length > 64) return fail('pwTooLong');
  const report = checkChorale(read.chords, tonic, mode, level);
  const rows: KitRow[] = [
    { key: 'numeralsOut', value: report.numerals.join(' – ') },
    { key: 'cadenceOut', value: '', word: CADENCE_WORDS[report.cadence] },
    report.issues.length === 0
      ? { key: 'issuesOut', value: '', word: 'cleanPass' }
      : { key: 'issuesOut', value: String(report.issues.length) },
  ];
  for (const issue of report.issues) {
    const who = issue.voices.length > 0 ? issue.voices.join('–') : 'all voices';
    rows.push({ key: 'issueRow', vars: { n: String(issue.chord) }, value: `${cap(who)}: ${RULE_TEXT[issue.rule]}` });
  }
  const bad = new Set(report.issues.map((i) => i.chord));
  const label = `${read.chords.length} chords in ${pitchClassName(tonic)} ${mode}${bad.size > 0 ? `, problems in chords ${[...bad].join(', ')}` : ', no problems'}`;
  return ok({
    rows,
    steps: [
      { key: 'pwCompare', vars: { voices: VOICES.join(', ') } },
      { key: 'pwParallel' },
      { key: 'pwLevel', vars: { level: level } },
    ],
    answer:
      report.issues.length === 0
        ? `No problems found in ${read.chords.length} chords in ${pitchClassName(tonic)} ${mode}.`
        : `${report.issues.length} problem${report.issues.length === 1 ? '' : 's'}: ${report.issues.map((i) => `chord ${i.chord} ${i.voices.join('–') || 'chord'} ${RULE_TEXT[i.rule]}`).join('; ')}`,
    svg: { markup: chordPicture(read.chords, bad, label), label },
    notes: ['pwNoteRules', 'pwNoteLevels'],
  });
}

export function speciesMode(v: Values): KitOk {
  const species = (Number(v.species) >= 1 && Number(v.species) <= 4 ? Number(v.species) : 1) as Species;
  const above = v.position !== 'below';
  const cantus = readNotes(v.cantus ?? '') ?? fail('pwCantusFormat');
  const line = readNotes(v.line ?? '') ?? fail('pwLineFormat');
  if (cantus.length < 3) return fail('pwCantusShort');
  if (line.length !== expectedLength(cantus.length, species)) {
    return fail('pwLineLength', {
      count: String(line.length),
      wanted: String(expectedLength(cantus.length, species)),
      per: String(PER_MEASURE[species]),
      cantus: String(cantus.length),
    });
  }
  const issues = checkSpecies(cantus, line, species, above);
  const rows: KitRow[] = [
    issues.length === 0
      ? { key: 'issuesOut', value: '', word: 'cleanPass' }
      : { key: 'issuesOut', value: String(issues.length) },
  ];
  for (const issue of issues) {
    rows.push({ key: 'measureRow', vars: { n: String(issue.measure) }, value: cap(SPECIES_TEXT[issue.rule]) });
  }
  return ok({
    rows,
    steps: [
      { key: 'pwSpeciesBeats', vars: { per: String(PER_MEASURE[species]) } },
      { key: 'pwSpeciesConsonant' },
      { key: 'pwSpeciesMotion' },
    ],
    answer:
      issues.length === 0
        ? `No problems found in the species ${species} line.`
        : `${issues.length} problem${issues.length === 1 ? '' : 's'}: ${issues.map((i) => `measure ${i.measure}, ${SPECIES_TEXT[i.rule]}`).join('; ')}`,
    notes: ['pwNoteSpecies'],
  });
}
