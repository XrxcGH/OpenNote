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
    link: 'Paste link needs cells copied from a table on this page.',
    styles: 'The table has too many cell styles, so nothing was pasted.',
    merges: 'Some merged cells could not be kept because they overlap.',
    header: 'A formula landed in the header row, so its value was pasted instead.',
    asValues: 'The copy did not say where it began, so its formulas were pasted as values.',
    dropped: 'The paste was larger than a table can be, so the cells past the limit were left out.',
    leftColumns:
      'A table holds at most {max} columns, so {count, plural, one {# pasted column was} other {# pasted columns were}} left out.',
    leftRows:
      'A table holds at most {max} rows, so {count, plural, one {# pasted row was} other {# pasted rows were}} left out.',
    equalsText: 'Some pasted text starts with an equals sign, so it now works as a formula.',
    validation: 'Validation rules paste only from a table on this page, so some rules were left out.',
    divide: 'Some cells were divided by zero, so they now show a division error.',
  },
  commands: {
    keywords: 'table paste special values formats transpose operation skip blanks link',
    special: 'Paste special…',
    values: 'Paste values only',
  },
} as const;
