// Undo and redo messages, the read-only bar, and reload notices (owner: WP2).
// Each namespace file has one owner, so parallel work never edits the same file.

const THING = '{thing, select, text {a text box} image {an image} table {a table} other {a block}}';

export const pageSync = {
  undo: 'Undo',
  redo: 'Redo',
  /** Said when an undo changed something outside the focused text box (ARCHITECTURE.md section 10.5). */
  undid: {
    editing: `{count, plural, one {Undid changing ${THING}.} other {Undid changing # blocks.}}`,
    moving: `{count, plural, one {Undid moving ${THING}.} other {Undid moving # blocks.}}`,
    adding: `{count, plural, one {Undid adding ${THING}.} other {Undid adding # blocks.}}`,
    deleting: `{count, plural, one {Undid deleting ${THING}.} other {Undid deleting # blocks.}}`,
    page: 'Undid changing the page.',
  },
  redid: {
    editing: `{count, plural, one {Redid changing ${THING}.} other {Redid changing # blocks.}}`,
    moving: `{count, plural, one {Redid moving ${THING}.} other {Redid moving # blocks.}}`,
    adding: `{count, plural, one {Redid adding ${THING}.} other {Redid adding # blocks.}}`,
    deleting: `{count, plural, one {Redid deleting ${THING}.} other {Redid deleting # blocks.}}`,
    page: 'Redid changing the page.',
  },
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  undoFailed: 'This change can’t be undone, because it was changed in another window.',
  redoFailed: 'This change can’t be redone, because it was changed in another window.',
  /** A change the core refused. The text stays on the page, and the next change tries again. */
  notKept: {
    readOnly: 'This page is read-only, so that change wasn’t kept.',
    locked: 'That block is locked, so that change wasn’t kept.',
    other: 'That change couldn’t be kept. Try it again.',
  },
  /** The window stays open: a change the core refused is still on the page and not saved. */
  exitUnsaved: 'Some changes on this page aren’t saved yet. Try closing again in a moment.',
  reloaded: 'This page changed in another app, so it was reloaded.',
} as const;
