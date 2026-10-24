// The custom window frame: the caption buttons (ARCHITECTURE.md section 10.3). The names match Windows' own caption
// buttons, so Narrator, Voice Access ("click Minimize"), and people who know Windows find them.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const frame = {
  captionButtons: 'Window controls',
  minimize: 'Minimize',
  maximize: 'Maximize',
  restore: 'Restore',
  close: 'Close',
} as const;
