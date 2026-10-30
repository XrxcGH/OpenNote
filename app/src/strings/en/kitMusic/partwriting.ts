// The voice-leading checker's text: field labels, result rows, worked steps, notes, and problems.
export const partwriting = {
  t: {
    partwriting: {
      title: 'Voice-leading checker',
      short: 'Voice leading',
      keywords:
        'voice leading part writing four-part chorale harmony counterpoint species parallel fifths octaves cantus ' +
        'firmus soprano alto tenor bass spacing leading tone seventh',
      about:
        'Check four-part chorale writing and two-voice species counterpoint against the common-practice rules, with ' +
        'each problem located and explained.',
    },
  },
  f: {
    pwMode: 'What to check',
    pwChorale: 'Four-part chorale writing',
    pwSpecies: 'Species counterpoint',
    pwTonic: 'Key',
    pwTonicHint: 'Write the tonic, such as C, F#, or Eb.',
    pwKeyMode: 'Mode',
    pwMajor: 'Major',
    pwMinor: 'Minor',
    pwStrictness: 'Rule set',
    pwRelaxed: 'Relaxed: parallels, crossing, sevenths, and augmented leaps',
    pwStandard: 'Standard: adds ranges, spacing, doubling, and leading tone',
    pwStrict: 'Strict: adds leap recovery and inner-voice leading tones',
    pwChords: 'Chords, one on each line',
    pwChordsHint: 'Write four notes with octaves, soprano first: E5 C5 G4 C3.',
    pwSpeciesNo: 'Species',
    pwFirst: 'First: note against note',
    pwSecond: 'Second: two notes against one',
    pwThird: 'Third: four notes against one',
    pwFourth: 'Fourth: syncopation',
    pwPosition: 'The new line is',
    pwAbove: 'Above the cantus firmus',
    pwBelow: 'Below the cantus firmus',
    pwCantus: 'Cantus firmus',
    pwCantusHint: 'Write the notes with octaves, such as C4 D4 E4 D4 C4.',
    pwLine: 'Counterpoint',
    pwLineHint:
      'One note for each note of the cantus in first species, more in the others, and a single note at the end.',
  },
  r: {
    numeralsOut: 'Roman numerals',
    cadenceOut: 'Cadence',
    cadencePerfect: 'Perfect authentic cadence',
    cadenceAuthentic: 'Authentic cadence',
    cadencePlagal: 'Plagal cadence',
    cadenceDeceptive: 'Deceptive cadence',
    cadenceHalf: 'Half cadence',
    cadenceNone: 'No standard cadence at the end',
    issuesOut: 'Problems found',
    cleanPass: 'None: a clean pass',
    issueRow: 'Chord {n}',
    measureRow: 'Measure {n}',
  },
  s: {
    pwCompare:
      'Each chord is read as four voices ({voices}). Each voice is compared with its neighbors and with the next chord.',
    pwParallel:
      'Two voices make parallel fifths or octaves when they are the same perfect interval in two chords in a row ' +
      'and both move the same way.',
    pwLevel:
      'The {level} rule set was used. Textbooks differ, so try another set if your course teaches it differently.',
    pwSpeciesBeats: 'Each cantus note has {per} note(s) against it, and the last measure has one.',
    pwSpeciesConsonant:
      'Strong beats must be consonant: unisons, thirds, fifths, sixths, and octaves. A fourth is a dissonance between two voices.',
    pwSpeciesMotion:
      'Between strong beats, a perfect interval must not be reached by similar motion, and fifths or octaves must not follow each other.',
  },
  e: {
    pwTonicFormat: 'The key needs a note letter with an optional sharp or flat, such as C, F#, or Eb.',
    pwEmpty: 'Type the chords first, one on each line.',
    pwChordCount: 'Line {line} needs exactly four notes, soprano first.',
    pwChordNote: 'Line {line} has a note this tool cannot read. Write notes with octaves, such as C5 or Bb3.',
    pwTooLong: 'Check up to 64 chords at a time.',
    pwCantusFormat: 'The cantus firmus needs notes with octaves, such as C4 D4 E4.',
    pwLineFormat: 'The counterpoint needs notes with octaves, such as G4 F4 G4.',
    pwCantusShort: 'The cantus firmus needs at least three notes.',
    pwLineLength:
      'The counterpoint has {count} notes. For {cantus} cantus notes this species needs {wanted}: {per} against each, then one at the end.',
  },
  n: {
    pwNoteRules:
      'The rules are the common-practice ones most textbooks share. A rule broken on purpose can be good writing.',
    pwNoteLevels: 'Ranges used: soprano C4 to G5, alto G3 to D5, tenor C3 to G4, bass E2 to C4.',
    pwNoteSpecies: 'Fifth species and free counterpoint are not checked.',
  },
} as const;
