// The extra import, export, embed, and integration features (Phase 11 and later). One namespace for the whole area,
// so parallel work never edits the same strings file.

export const moreInterop = {
  snip: {
    offer: 'You copied a screenshot. Add it to this page?',
    add: 'Add to page',
  },
  setup: {
    title: 'Bring in your notes',
    subtitle: 'If your notes live in another app, OpenNote can bring them over. Nothing changes in the other app.',
    label: 'Your notes',
    fresh: 'Start with a new notebook',
    freshHint: 'You can import notes any time with Import notes in the Home tab.',
    bring: 'Bring in notes when setup is done',
    bringHint: 'OpenNote opens the import window, and checks what will and will not come over before adding anything.',
    apps: 'OpenNote reads Word, Excel, PowerPoint, and OpenDocument files, OneNote exports, Evernote, Notion, Obsidian, Joplin, Google Keep, and Windows Sticky Notes.',
  },
  report: {
    save: 'Save report…',
    saved: 'The import report was saved.',
    savedTo: 'Report saved as {name}.',
    failed: 'The report could not be saved. Choose another folder.',
  },
} as const;
