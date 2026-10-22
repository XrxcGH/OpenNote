// The language of spelling, recognition, the voice, and the dictionary: its setup step and Settings section.
// Each namespace file has one owner, so parallel work never edits the same file.

export const language = {
  pickerLabel: 'Language',
  other: {
    label: 'Another language',
    choose: 'Choose another language',
    checking: 'Looking for installed languages',
    hint: 'These are the languages Windows can spell-check or recognize on this PC. OpenNote opens nothing outside the app.',
    none: 'Windows has no other language for spelling or recognition on this PC. English is always available.',
  },
  dictionary: {
    english:
      'The dictionary and thesaurus use English, with {name} spelling first. ' +
        'Spelling, handwriting and math recognition, text in pictures, and read aloud follow it too.',
    noPack:
      'There is no dictionary for {name} yet, so the English one stays available. Spelling, recognition, and read aloud still use {name}.',
  },
  setup: {
    subtitle:
      'English (United States) is chosen for you, even when Windows uses another language. Change it any time in Settings.',
    interface: "OpenNote's own text stays in American English for now, because translations aren't built yet.",
  },
  settings: {
    title: 'Language and spelling',
    intro:
      'This one choice sets spelling, handwriting and math recognition, text in pictures, read aloud, hyphenation, and the dictionary.',
  },
} as const;
