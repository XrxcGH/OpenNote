// Descriptions of the logical and information functions: one line per function (`about`) and one per argument
// (`args`, by the argument's name in the signature). Written fresh in American English.
// Owner: tables:fn-logic-info (B10). shared:x-shared registered it in the string index, and the owner fills it in.

const value = 'The value to check.';

export const fnLogicInfo = {
  AND: { about: 'Gives TRUE when every argument is true.', args: { logical: 'A value, array, or range to test.' } },
  OR: { about: 'Gives TRUE when any argument is true.', args: { logical: 'A value, array, or range to test.' } },
  XOR: {
    about: 'Gives TRUE when an odd number of arguments are true.',
    args: { logical: 'A value, array, or range to test.' },
  },
  NOT: { about: 'Turns TRUE into FALSE and FALSE into TRUE.', args: { logical: 'The value to flip.' } },
  TRUE: { about: 'Gives the logical value TRUE.', args: {} },
  FALSE: { about: 'Gives the logical value FALSE.', args: {} },
  IF: {
    about: 'Gives one result when a test is true and another when it is false.',
    args: {
      test: 'The condition.',
      then: 'The result when true.',
      otherwise: 'The result when false. FALSE if left out.',
    },
  },
  IFERROR: {
    about: 'Gives a fallback when a value is an error.',
    args: { value: 'The value to check.', on_error: 'The result when the value is an error.' },
  },
  IFNA: {
    about: 'Gives a fallback when a value is #N/A.',
    args: { value: 'The value to check.', on_na: 'The result when the value is #N/A.' },
  },
  IFS: {
    about: 'Gives the result of the first test that is true. #N/A when none is.',
    args: { test: 'A condition.', result: 'The result when that condition is true.' },
  },
  SWITCH: {
    about: 'Compares a value with a list of matches and gives the result of the first one that is equal.',
    args: {
      value: 'The value to compare.',
      match: 'A value to compare it with.',
      result: 'The result when it matches.',
      default: 'The result when nothing matches. #N/A if left out.',
    },
  },
  LET: {
    about: 'Gives names to values, then calculates with them.',
    args: {
      name: 'A name to define.',
      value: 'The value of that name.',
      calculation: 'The formula that uses the names.',
    },
  },
  LAMBDA: {
    about: 'Makes a function of your own. Call it right away or give it a name.',
    args: { parameter: 'A name the function takes as input.', calculation: 'The formula that uses the inputs.' },
  },
  CELL: {
    about: 'Gives facts about a cell, such as its address, row, column, type, or format.',
    args: {
      info_type: 'What to report: address, col, row, contents, type, format, width, filename, and a few more.',
      reference: 'The cell to ask about. This cell if left out.',
    },
  },
  ERROR_TYPE: {
    about: 'Gives a number for the kind of error, such as 2 for divide by zero and 7 for not available.',
    args: { error: 'The error.' },
  },
  INFO: {
    about: 'Gives a fact about this page that is safe to share, such as the calculation mode.',
    args: { type_text: 'What to report: numfile, origin, recalc, or system.' },
  },
  ISBLANK: { about: 'Gives TRUE for an empty cell.', args: { value } },
  ISNUMBER: { about: 'Gives TRUE for a number. Text that looks like a number is not one.', args: { value } },
  ISTEXT: { about: 'Gives TRUE for text.', args: { value } },
  ISNONTEXT: { about: 'Gives TRUE for anything that is not text, an empty cell included.', args: { value } },
  ISLOGICAL: { about: 'Gives TRUE for TRUE or FALSE.', args: { value } },
  ISERROR: { about: 'Gives TRUE for any error.', args: { value } },
  ISERR: { about: 'Gives TRUE for any error except #N/A.', args: { value } },
  ISNA: { about: 'Gives TRUE for #N/A.', args: { value } },
  ISEVEN: {
    about: 'Gives TRUE when a number is even. A fraction is cut off first.',
    args: { number: 'The number to check.' },
  },
  ISODD: {
    about: 'Gives TRUE when a number is odd. A fraction is cut off first.',
    args: { number: 'The number to check.' },
  },
  ISFORMULA: { about: 'Gives TRUE when a cell holds a formula.', args: { reference: 'The cell to check.' } },
  ISOMITTED: {
    about: 'In a function made with LAMBDA, gives TRUE when an optional input was left out.',
    args: { argument: 'The name of the input.' },
  },
  ISREF: { about: 'Gives TRUE when the value is a reference to cells.', args: { value } },
  ISEMAIL: { about: 'Gives TRUE for text shaped like an email address.', args: { value } },
  ISURL: { about: 'Gives TRUE for text shaped like a web address.', args: { value } },
  ISDATE: { about: 'Gives TRUE for text that reads as a date.', args: { value } },
  N: { about: 'Turns a value into a number. TRUE is 1, text is 0.', args: { value: 'The value to convert.' } },
  NA: { about: 'Gives the error #N/A, which means a value is not available.', args: {} },
  SHEET: {
    about: 'Gives the position of a table on the page, counting from 1.',
    args: { value: 'A reference or a table name. This table if left out.' },
  },
  SHEETS: {
    about: 'Gives how many tables the page has.',
    args: { reference: 'A reference to count the tables in. The whole page if left out.' },
  },
  TYPE: {
    about: 'Gives a code for the kind of value: 1 number, 2 text, 4 logical, 16 error, 64 array.',
    args: { value },
  },
} as const;
