// Paste Options and the paste default for each source.
// Owner: text:clipboard (B10). shared:x-shared registered it in the string index, and the owner fills it in.

export const textPaste = {
  keepSource: 'Keep source formatting',
  mergeFormatting: 'Merge formatting',
  textOnly: 'Keep text only',
  chip: 'Pasted: {choice}.',
  options: 'Paste options',
  menu: 'Paste options',
  switched: 'Changed the paste to {choice}.',
  settings: {
    title: 'Paste formatting',
    hint: 'What a paste keeps. The Paste options notice after each paste changes the choice for that paste.',
    word: 'From Word',
    docs: 'From Google Docs',
    onenote: 'From OneNote',
    web: 'From a web page',
  },
} as const;
