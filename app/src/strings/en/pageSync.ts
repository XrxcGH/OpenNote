// Undo and redo messages, the read-only bar, and reload notices (owner: WP2).
// Each namespace file has one owner, so parallel work never edits the same file.

export const pageSync = {
  undo: 'Undo',
  redo: 'Redo',
} as const;
