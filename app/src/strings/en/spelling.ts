// Spell check, its menus, and its settings (owner: WP7).
// Each namespace file has one owner, so parallel work never edits the same file.

export const spelling = {
  commands: {
    next: 'Next spelling error',
    previous: 'Previous spelling error',
    keywords: 'spell check misspelled word dictionary',
  },
  menu: {
    label: 'Spelling',
    noSuggestions: 'No suggestions',
    add: 'Add to dictionary',
    ignore: 'Ignore',
  },
  misspelled: 'Misspelled: {word}. {count, plural, =0 {No suggestions.} one {# suggestion.} other {# suggestions.}}',
  first: 'First: {word}.',
  none: 'No spelling errors.',
  settings: {
    title: 'Spelling',
    check: 'Check spelling',
    languages: 'Languages',
    languagesHint: 'With several languages, a word is flagged only when every language flags it.',
    defaultLanguage: '{name} (from Windows)',
    ignoreUppercase: 'Ignore words in all capitals',
    ignoreWithDigits: 'Ignore words with numbers',
    personal: 'Personal dictionary',
    personalEmpty: 'No words yet. Add one from the spelling menu.',
    remove: 'Remove',
    removeWord: 'Remove {word}',
    unavailable: 'Spell check needs a language with spelling support. Add one in Windows Settings.',
    openWindows: 'Open Windows language settings',
  },
} as const;
