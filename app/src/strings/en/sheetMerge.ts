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
  warn: {
    title: 'Merge these cells?',
    body: 'Only the top-left value stays. {count, plural, one {# value goes} other {# values go}}. Undo restores it.',
    confirm: 'Merge',
  },
  announce: {
    mergeCells: 'Cells merged.',
    unmergeCells: 'Cells unmerged.',
    splitCell: 'Cell split.',
  },
  sort: {
    refused: 'Cannot sort: the range has merged cells of different sizes.',
  },
} as const;
