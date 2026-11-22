// Merge, merge and center, merge across, unmerge, and split cell.
// Owner: tables:merge (B11). Every interface string is a full sentence, never joined from pieces.

export const sheetMerge = {
  commands: {
    keywords: 'table merge cells center across vertically unmerge split cell combine',
    merge: 'Merge cells',
    keep: 'Merge cells and keep all text',
    center: 'Merge and center',
    across: 'Merge across',
    vertical: 'Merge vertically',
    unmerge: 'Unmerge cells',
    split: 'Split cell…',
    split2x1: 'Split cell into 2 columns',
    split1x2: 'Split cell into 2 rows',
  },
  split: {
    title: 'Split cell',
    columns: 'Number of columns',
    rows: 'Number of rows',
    confirm: 'Split',
    errorColumns: 'Enter at least 1 column.',
    errorRows: 'Enter at least 1 row.',
    errorSame: 'Choose 2 or more cells: more than 1 column or more than 1 row.',
    errorMany: 'A split makes at most 64 cells. Use fewer columns or rows.',
  },
  warn: {
    title: 'Merge these cells?',
    body: 'Only the top-left value stays. {count, plural, one {# value goes} other {# values go}}. Undo restores it.',
    confirm: 'Merge',
  },
  announce: {
    mergeCells: 'Cells merged.',
    unmergeCells: 'Cells unmerged.',
    splitCell: 'Cell split.',
    mergeBlocked: 'Cannot merge: the cells cut through another merged cell, or there are too many merges.',
    moveBlocked: 'Cannot move the row: it would cut through a merged cell.',
  },
  sort: {
    refused: 'Cannot sort: the range has cells merged across rows.',
  },
} as const;
