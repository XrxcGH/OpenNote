// Copy, cut, paste, and Paste special in tables (ADR 0067).
// Owner: tables:clipboard (B11). Every interface string is a full sentence, never joined from pieces.

export const sheetClipboard = {
  special: {
    title: 'Paste special',
    what: 'Paste',
    operation: 'Operation',
    confirm: 'Paste',
    skipBlanks: 'Skip blanks',
    transpose: 'Transpose',
    link: 'Paste link',
    empty: 'The clipboard holds no cells to paste.',
  },
  what: {
    all: 'All',
    formulas: 'Formulas',
    values: 'Values',
    formats: 'Formats',
    notes: 'Notes',
    validation: 'Validation',
    widths: 'Column widths',
    noBorders: 'All except borders',
    valuesAndNumberFormats: 'Values and number formats',
    formulasAndNumberFormats: 'Formulas and number formats',
  },
  operation: {
    none: 'None',
    add: 'Add',
    subtract: 'Subtract',
    multiply: 'Multiply',
    divide: 'Divide',
  },
  announce: {
    copied: '{count, plural, one {Copied # cell.} other {Copied # cells.}}',
    cut: '{count, plural, one {Cut # cell.} other {Cut # cells.}}',
    pasted: '{cells, plural, one {Pasted # cell.} other {Pasted # cells.}}',
    validation: 'Validation rules do not travel on the clipboard yet, so none were pasted.',
    link: 'Paste link needs cells copied from a table on this page.',
    styles: 'The table has too many cell styles, so nothing was pasted.',
    merges: 'Some merged cells could not be kept because they overlap.',
    header: 'A formula landed in the header row, so its value was pasted instead.',
  },
  commands: {
    keywords: 'table paste special values formats transpose operation skip blanks link',
    special: 'Paste special…',
    values: 'Paste values only',
  },
} as const;
