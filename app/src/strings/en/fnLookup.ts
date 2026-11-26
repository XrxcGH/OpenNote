// Descriptions of the lookup and reference functions, one line per function and one per argument, in our own words.
// Owner: tables:fn-lookup (B10). Typed loosely, as the other family files are, so the message key union stays small.

export const fnLookup: Record<string, unknown> = {
  VLOOKUP: {
    summary: 'Finds a value in the first column of a table and gives the value in the same row of another column.',
    args: {
      lookup_value: 'The value to find in the first column.',
      table_array: 'The table to search. Its first column holds the values to find.',
      col_index_num: 'Which column to give, counting the first column as 1.',
      range_lookup: 'TRUE or left out finds the nearest smaller value in sorted data. FALSE finds an exact match.',
    },
  },
  HLOOKUP: {
    summary: 'Finds a value in the first row of a table and gives the value in the same column of another row.',
    args: {
      lookup_value: 'The value to find in the first row.',
      table_array: 'The table to search. Its first row holds the values to find.',
      row_index_num: 'Which row to give, counting the first row as 1.',
      range_lookup: 'TRUE or left out finds the nearest smaller value in sorted data. FALSE finds an exact match.',
    },
  },
  LOOKUP: {
    summary: 'Finds the nearest smaller value in sorted data and gives the matching value from another row or column.',
    args: {
      lookup_value: 'The value to find.',
      lookup_vector: 'One sorted row or column to search, or a table whose first row or column is searched.',
      result_vector: 'Where to give a value from. Left out, the far side of the table opposite the searched one.',
    },
  },
  MATCH: {
    summary: 'Gives the position of a value in a row or column.',
    args: {
      lookup_value: 'The value to find. With 0 as the type, * and ? match any text and one character.',
      lookup_array: 'One row or column to search.',
      match_type: '1 or left out: nearest smaller in ascending data. 0: exact. -1: nearest larger in descending data.',
    },
  },
  XLOOKUP: {
    summary: 'Finds a value in one row or column and gives what is in the same place in another.',
    args: {
      lookup_value: 'The value to find.',
      lookup_array: 'One row or column to search.',
      return_array: 'The rows or columns to give a result from, as long as the searched one.',
      if_not_found: 'What to give when nothing matches. Left out, the result is #N/A.',
      match_mode:
        'Exact is 0. Exact or the next smaller is -1. Exact or the next larger is 1. Wildcards are 2. A pattern is 3.',
      search_mode: '1 first to last, -1 last to first, 2 a fast search of ascending data, -2 of descending data.',
    },
  },
  XMATCH: {
    summary: 'Gives the position of a value in a row or column, with the same choices as XLOOKUP.',
    args: {
      lookup_value: 'The value to find.',
      lookup_array: 'One row or column to search.',
      match_mode:
        'Exact is 0. Exact or the next smaller is -1. Exact or the next larger is 1. Wildcards are 2. A pattern is 3.',
      search_mode: '1 first to last, -1 last to first, 2 a fast search of ascending data, -2 of descending data.',
    },
  },
  INDEX: {
    summary: 'Gives the cell at a row and column of a block, or a whole row or column when one of them is 0.',
    args: {
      array: 'The block of cells or the array to pick from. A union such as (A1:B2,D1:E2) has several areas.',
      row_num: 'The row, counting from 1. 0 gives every row.',
      column_num: 'The column, counting from 1. 0 gives every column.',
      area_num: 'Which area of a union to use. Left out, the first.',
    },
  },
  OFFSET: {
    summary: 'Gives a block that starts a number of rows and columns away from a reference. It recalculates often.',
    args: {
      reference: 'Where to start counting.',
      rows: 'How many rows down to move. A negative number moves up.',
      cols: 'How many columns right to move. A negative number moves left.',
      height: 'How many rows the block has. Left out, as many as the reference.',
      width: 'How many columns the block has. Left out, as many as the reference.',
    },
  },
  INDIRECT: {
    summary: 'Gives the cells that a piece of text names, such as "B2". It recalculates often.',
    args: {
      ref_text: 'The reference as text.',
      a1: 'TRUE or left out reads A1 style. FALSE reads R1C1 style, where R[1]C[-1] counts from this cell.',
    },
  },
  CHOOSE: {
    summary: 'Gives one value from a list, picked by its number.',
    args: {
      index_num: 'Which value to give, counting from 1.',
      value: 'A value, a reference, or an array to choose from.',
    },
  },
  ROW: {
    summary: 'Gives the row number of a reference, or of this cell when left out.',
    args: { reference: 'The cell or block. A block gives one number per row.' },
  },
  COLUMN: {
    summary: 'Gives the column number of a reference, or of this cell when left out.',
    args: { reference: 'The cell or block. A block gives one number per column.' },
  },
  ROWS: {
    summary: 'Gives how many rows a reference or an array has.',
    args: { array: 'The block of cells or the array.' },
  },
  COLUMNS: {
    summary: 'Gives how many columns a reference or an array has.',
    args: { array: 'The block of cells or the array.' },
  },
  ADDRESS: {
    summary: 'Writes a cell reference as text from its row and column numbers.',
    args: {
      row_num: 'The row number.',
      column_num: 'The column number.',
      abs_num: '1 or left out: $A$1. 2: A$1. 3: $A1. 4: A1.',
      a1: 'TRUE or left out writes A1 style. FALSE writes R1C1 style.',
      sheet_text: 'A table name to put in front, such as Sales.',
    },
  },
  AREAS: {
    summary: 'Gives how many areas a reference has, such as 2 for (A1:B2,D4).',
    args: { reference: 'The reference to count.' },
  },
  FORMULATEXT: {
    summary: 'Gives the formula in a cell as text. A cell without a formula gives #N/A.',
    args: { reference: 'The cell whose formula to show.' },
  },
  HYPERLINK: {
    summary: 'Shows a link. The cell opens it only when it is clicked.',
    args: {
      link_location: 'The address to open: a web page or an email address.',
      friendly_name: 'The text to show. Left out, the address itself.',
    },
  },
};
