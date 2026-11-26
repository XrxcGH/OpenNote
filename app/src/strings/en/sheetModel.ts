// Cell styles, the table look, and the sheet model of a table block.
// Owner: tables:sheet-model (B9). shared:x-shared registered it in the string index.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const sheetModel = {
  merge: {
    single: 'Select more than one cell to merge.',
    overlap: 'These cells overlap a merged cell. Unmerge it first, then merge again.',
    limit: 'This table already has 10,000 merged cells, the most a table can hold.',
    missing: 'These cells are no longer in the table.',
  },
  name: {
    name: 'A name starts with a letter, "_", or "\\" and has no spaces. It cannot look like a cell, such as A1 or R1C1.',
    ref: 'A name needs a value or formula of 1 to 8,192 characters.',
    comment: 'A comment holds at most 255 characters.',
    limit: 'This table already has 1,024 names, the most a table can hold.',
  },
  rules: {
    limit: 'This table already has 256 rules of this kind, the most a table can hold.',
  },
  styles: {
    limit:
      'This table already has 4,096 different cell styles, the most a table can hold. Clear some formatting first.',
  },
} as const;
