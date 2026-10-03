// Code commands and the language picker (owner: WP6). Every interface string is a full sentence here, never joined
// from pieces (ARCHITECTURE.md section 19).

export const code = {
  commands: {
    setLanguage: 'Set code language…',
    exit: 'Leave code block',
    keywords: 'code language syntax programming snippet',
  },
  language: {
    button: 'Code language: {name}',
    plain: 'Plain text',
    picker: 'Code language',
    filter: 'Filter languages',
    none: 'No language matches “{query}”.',
    set: 'Code language set to {name}.',
  },
} as const;
