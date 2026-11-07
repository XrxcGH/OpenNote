// Named styles and style sets.
// Owner: text:styles (B10). shared:x-shared registered it in the string index, and the owner fills it in.

export const textStyles = {
  gallery: 'Styles',
  changed: 'Style changed.',
  changedSpoken: 'Style changed. Undo is in the notification.',
  undo: 'Undo',
  saveFailed: "Couldn't save the style. The notebook may be read-only.",
  loadFailed: "Couldn't read this notebook's styles. Try again in a moment.",
  noParagraph: 'Put the cursor in a paragraph first.',
  noNotebook: 'Open a page in a notebook to change its styles.',
  builtInDelete: "Built-in styles can't be deleted. You can hide them instead.",
  created: 'Style "{name}" created.',
  deleted: 'Style "{name}" deleted.',
  setChanged: 'Style set changed to {name}.',
  newStyleLabel: 'New style',
  modifyUnsupported:
    "This style can't be changed here yet. Format some text, then use Update style to match selection.",
  names: {
    title: 'Title',
    subtitle: 'Subtitle',
    citation: 'Citation',
    quote2: 'Intense quote',
    h7: 'Heading 7',
    h8: 'Heading 8',
    h9: 'Heading 9',
  },
  sets: {
    opennote: 'OpenNote',
    word2016: 'Word 2013 to 2021',
    word365: 'Word for Microsoft 365',
    googleDocs: 'Google Docs',
  },
  summary: {
    bold: 'bold',
    italic: 'italic',
  },
  source: {
    app: 'Built in',
    notebook: 'This notebook',
    page: 'This page',
  },
  commands: {
    apply: 'Apply style',
    update: 'Update style to match selection',
    create: 'New style from selection',
    modify: 'Modify style',
    remove: 'Delete style',
    hide: 'Hide from the style gallery',
    show: 'Show in the style gallery',
    moveUp: 'Move earlier in the style gallery',
    moveDown: 'Move later in the style gallery',
    chooseSet: 'Choose a style set',
  },
} as const;
