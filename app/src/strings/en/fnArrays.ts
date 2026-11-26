// Descriptions of the dynamic array, matrix, and LAMBDA helper functions, one line each, written fresh in American
// English. Owner: tables:fn-arrays (B11). Each function has a description and a line for each argument. `reasons`
// holds the words for an error a function explains, such as an array past the size cap.

const arg = {
  array: 'The block of values to use.',
  array1: 'The first matrix.',
  array2: 'The second matrix. It has as many rows as the first has columns.',
  arrayFormula: 'A formula. Every formula here already works on arrays, so this gives the formula as it is.',
  byArray: 'The row or column of values to sort by, as long as the array.',
  byCol: 'TRUE to work on columns instead of rows. FALSE when left out.',
  colNum: 'Which column to take. A negative number counts from the end.',
  columns: 'How many columns. It is 1 when left out.',
  dimension: 'How many rows and columns the identity matrix has.',
  exactlyOnce: 'TRUE to keep only the values that appear once. FALSE when left out.',
  ifEmpty: 'What to give when nothing passes the test.',
  ignore: 'Which items to skip: 0 none, 1 empty cells, 2 errors, 3 both. It is 0 when left out.',
  include: 'TRUE or FALSE for each row (or column) of the array: which ones to keep.',
  initial: 'The value to start from. Empty when left out.',
  integer: 'TRUE for whole numbers only. FALSE when left out.',
  lambda: 'A function made with LAMBDA.',
  matrix: 'A square block of numbers.',
  max: 'The largest value allowed. It is 1 when left out.',
  min: 'The smallest value allowed. It is 0 when left out.',
  n: 'How many rows to keep. It is 1 when left out.',
  padWith: 'The value for the cells that have nothing. It is #N/A when left out.',
  range: 'The block of cells to use.',
  rowNum: 'Which row to take. A negative number counts from the end.',
  rows: 'How many rows. A negative number counts from the end.',
  rowsBuilt: 'How many rows. It is 1 when left out.',
  scanByColumn: 'TRUE to read down each column. FALSE, the default, reads across each row.',
  sortColumn: 'Which column to sort by.',
  sortIndex: 'Which column (or row) to sort by. It is 1 when left out.',
  sortOrder: '1 for smallest first, -1 for largest first. It is 1 when left out.',
  isAscending: 'TRUE for smallest first, FALSE for largest first.',
  start: 'The first number. It is 1 when left out.',
  step: 'How much each number grows. It is 1 when left out.',
  ties: 'How to treat ties: 0 none, 1 keep ties with the last row, 2 drop repeats, 3 keep every copy of the top rows.',
  trim: 'Which empty lines to trim: 0 none, 1 leading, 2 trailing, 3 both. It is 3 when left out.',
  vector: 'A single row or column of values.',
  wrapCount: 'How many values go in each line.',
} as const;

/** A function's line and one line per argument, by argument name. */
export interface FnText {
  readonly description: string;
  readonly params: Readonly<Record<string, string>>;
}

// Typed as unknown values on purpose. Function text is looked up by function name at run time, never through t().
export const fnArrays: Readonly<Record<string, unknown>> = {
  reasons: { tooMany: 'Too many values' },
  ARRAYFORMULA: { description: 'Gives a formula as it is.', params: { array_formula: arg.arrayFormula } },
  BYCOL: {
    description: 'Calls a function on each column of an array and gives one value per column.',
    params: { array: arg.array, lambda: arg.lambda },
  },
  BYROW: {
    description: 'Calls a function on each row of an array and gives one value per row.',
    params: { array: arg.array, lambda: arg.lambda },
  },
  CHOOSECOLS: {
    description: 'Takes the chosen columns of an array.',
    params: { array: arg.array, col_num: arg.colNum },
  },
  CHOOSEROWS: { description: 'Takes the chosen rows of an array.', params: { array: arg.array, row_num: arg.rowNum } },
  DROP: {
    description: 'Removes rows or columns from the start or the end of an array.',
    params: { array: arg.array, rows: arg.rows, columns: arg.rows },
  },
  EXPAND: {
    description: 'Makes an array larger, filling the new cells.',
    params: { array: arg.array, rows: arg.rowsBuilt, columns: arg.columns, pad_with: arg.padWith },
  },
  FILTER: {
    description: 'Keeps the rows (or columns) of an array that pass a test.',
    params: { array: arg.array, include: arg.include, if_empty: arg.ifEmpty },
  },
  FLATTEN: { description: 'Puts every value of the ranges in one column, row by row.', params: { range: arg.range } },
  HSTACK: { description: 'Joins arrays side by side.', params: { array: arg.array } },
  MAKEARRAY: {
    description: 'Builds an array by calling a function with each cell’s row and column number.',
    params: { rows: arg.rowsBuilt, columns: arg.columns, lambda: arg.lambda },
  },
  MAP: {
    description: 'Calls a function on each value of one or more arrays.',
    params: { array: arg.array, lambda: arg.lambda },
  },
  MDETERM: { description: 'Gives the determinant of a square matrix.', params: { array: arg.matrix } },
  MINVERSE: { description: 'Gives the inverse of a square matrix.', params: { array: arg.matrix } },
  MMULT: { description: 'Multiplies a matrix by another.', params: { array1: arg.array1, array2: arg.array2 } },
  MUNIT: { description: 'Gives the identity matrix of a size.', params: { dimension: arg.dimension } },
  RANDARRAY: {
    description: 'Gives an array of random numbers.',
    params: { rows: arg.rowsBuilt, columns: arg.columns, min: arg.min, max: arg.max, integer: arg.integer },
  },
  REDUCE: {
    description: 'Combines the values of an array into one result, a step at a time.',
    params: { initial_value: arg.initial, array: arg.array, lambda: arg.lambda },
  },
  SCAN: {
    description: 'Combines the values of an array a step at a time and gives every step.',
    params: { initial_value: arg.initial, array: arg.array, lambda: arg.lambda },
  },
  SEQUENCE: {
    description: 'Gives an array of numbers that grow by a step.',
    params: { rows: arg.rowsBuilt, columns: arg.columns, start: arg.start, step: arg.step },
  },
  SORT: {
    description: 'Sorts the rows (or columns) of an array.',
    params: { array: arg.array, sort_index: arg.sortIndex, sort_order: arg.sortOrder, by_col: arg.byCol },
  },
  SORTBY: {
    description: 'Sorts an array by the values of other rows or columns.',
    params: { array: arg.array, by_array: arg.byArray, sort_order: arg.sortOrder },
  },
  SORTN: {
    description: 'Sorts a range and keeps its first rows.',
    params: {
      range: arg.range,
      n: arg.n,
      display_ties_mode: arg.ties,
      sort_column: arg.sortColumn,
      is_ascending: arg.isAscending,
    },
  },
  TAKE: {
    description: 'Keeps rows or columns from the start or the end of an array.',
    params: { array: arg.array, rows: arg.rows, columns: arg.rows },
  },
  TOCOL: {
    description: 'Puts every value of an array in one column.',
    params: { array: arg.array, ignore: arg.ignore, scan_by_column: arg.scanByColumn },
  },
  TOROW: {
    description: 'Puts every value of an array in one row.',
    params: { array: arg.array, ignore: arg.ignore, scan_by_column: arg.scanByColumn },
  },
  TRANSPOSE: { description: 'Swaps the rows and columns of an array.', params: { array: arg.array } },
  TRIMRANGE: {
    description: 'Removes the empty rows and columns at the edges of a range.',
    params: { range: arg.range, trim_rows: arg.trim, trim_cols: arg.trim },
  },
  UNIQUE: {
    description: 'Keeps each distinct row (or column) of an array once.',
    params: { array: arg.array, by_col: arg.byCol, exactly_once: arg.exactlyOnce },
  },
  VSTACK: { description: 'Joins arrays one above the other.', params: { array: arg.array } },
  WRAPCOLS: {
    description: 'Cuts a row or column of values into columns of a set length.',
    params: { vector: arg.vector, wrap_count: arg.wrapCount, pad_with: arg.padWith },
  },
  WRAPROWS: {
    description: 'Cuts a row or column of values into rows of a set length.',
    params: { vector: arg.vector, wrap_count: arg.wrapCount, pad_with: arg.padWith },
  },
};
