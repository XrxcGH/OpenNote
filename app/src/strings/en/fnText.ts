// Descriptions of the text and regular expression functions.
// Owner: tables:fn-text (B10). One entry per function: a one-line summary and one line per argument.

export const fnText = {
  CONCAT: {
    summary: 'Joins text from values and ranges into one piece of text.',
    args: {
      text: 'A value or a range of cells to join.',
    },
  },
  CONCATENATE: {
    summary: 'Joins text from values into one piece of text.',
    args: {
      text: 'A value to join.',
    },
  },
  LEN: {
    summary: 'Counts the characters in text.',
    args: {
      text: 'The text to count.',
    },
  },
  LENB: {
    summary: 'Counts the bytes in text. Every character is one byte.',
    args: {
      text: 'The text to count.',
    },
  },
  LOWER: {
    summary: 'Changes text to lowercase.',
    args: {
      text: 'The text to change.',
    },
  },
  UPPER: {
    summary: 'Changes text to uppercase.',
    args: {
      text: 'The text to change.',
    },
  },
  TRIM: {
    summary: 'Removes spaces from the ends of text and reduces runs of spaces inside it to one.',
    args: {
      text: 'The text to clean up.',
    },
  },
  LEFT: {
    summary: 'Returns the first characters of text.',
    args: {
      text: 'The text to take from.',
      num_chars: 'How many characters to take. The default is 1.',
    },
  },
  LEFTB: {
    summary: 'Returns the first bytes of text. Every character is one byte.',
    args: {
      text: 'The text to take from.',
      num_chars: 'How many bytes to take. The default is 1.',
    },
  },
  RIGHT: {
    summary: 'Returns the last characters of text.',
    args: {
      text: 'The text to take from.',
      num_chars: 'How many characters to take. The default is 1.',
    },
  },
  RIGHTB: {
    summary: 'Returns the last bytes of text. Every character is one byte.',
    args: {
      text: 'The text to take from.',
      num_chars: 'How many bytes to take. The default is 1.',
    },
  },
  MID: {
    summary: 'Returns characters from the middle of text.',
    args: {
      text: 'The text to take from.',
      start_num: 'The position of the first character, counting from 1.',
      num_chars: 'How many characters to take.',
    },
  },
  MIDB: {
    summary: 'Returns bytes from the middle of text. Every character is one byte.',
    args: {
      text: 'The text to take from.',
      start_num: 'The position of the first byte, counting from 1.',
      num_chars: 'How many bytes to take.',
    },
  },
  REPLACE: {
    summary: 'Replaces part of text by position.',
    args: {
      old_text: 'The text to change.',
      start_num: 'The position of the first character to replace, counting from 1.',
      num_chars: 'How many characters to replace.',
      new_text: 'The text to put in.',
    },
  },
  REPLACEB: {
    summary: 'Replaces part of text by byte position. Every character is one byte.',
    args: {
      old_text: 'The text to change.',
      start_num: 'The position of the first byte to replace, counting from 1.',
      num_chars: 'How many bytes to replace.',
      new_text: 'The text to put in.',
    },
  },
  FIND: {
    summary: 'Finds text inside other text and returns where it starts. Case matters and wildcards do not work.',
    args: {
      find_text: 'The text to look for.',
      within_text: 'The text to look in.',
      start_num: 'The position to start at, counting from 1. The default is 1.',
    },
  },
  FINDB: {
    summary: 'Like FIND, counting in bytes. Every character is one byte.',
    args: {
      find_text: 'The text to look for.',
      within_text: 'The text to look in.',
      start_num: 'The position to start at, counting from 1. The default is 1.',
    },
  },
  SEARCH: {
    summary: 'Finds text inside other text. Case does not matter. Use ? for one character and * for a run.',
    args: {
      find_text: 'The text to look for.',
      within_text: 'The text to look in.',
      start_num: 'The position to start at, counting from 1. The default is 1.',
    },
  },
  SEARCHB: {
    summary: 'Like SEARCH, counting in bytes. Every character is one byte.',
    args: {
      find_text: 'The text to look for.',
      within_text: 'The text to look in.',
      start_num: 'The position to start at, counting from 1. The default is 1.',
    },
  },
  PROPER: {
    summary: 'Capitalizes the first letter of every word and lowercases the rest.',
    args: {
      text: 'The text to change.',
    },
  },
  CLEAN: {
    summary: 'Removes the characters that do not print, those with codes 0 to 31.',
    args: {
      text: 'The text to clean.',
    },
  },
  EXACT: {
    summary: 'Tells whether 2 pieces of text are the same, with case.',
    args: {
      text1: 'The first text.',
      text2: 'The second text.',
    },
  },
  REPT: {
    summary: 'Repeats text a number of times.',
    args: {
      text: 'The text to repeat.',
      number_times: 'How many times to repeat it.',
    },
  },
  SUBSTITUTE: {
    summary: 'Replaces matching text. Case matters.',
    args: {
      text: 'The text to change.',
      old_text: 'The text to find.',
      new_text: 'The text to put in.',
      instance_num: 'Which match to replace. Leave out to replace all.',
    },
  },
  T: {
    summary: 'Returns the value if it is text, and empty text if not.',
    args: {
      value: 'The value to check.',
    },
  },
  CHAR: {
    summary: 'Returns the character for a code from 1 to 255.',
    args: {
      number: 'The character code.',
    },
  },
  CODE: {
    summary: 'Returns the code of the first character of text.',
    args: {
      text: 'The text to read.',
    },
  },
  UNICHAR: {
    summary: 'Returns the character for a Unicode number.',
    args: {
      number: 'The Unicode number.',
    },
  },
  UNICODE: {
    summary: 'Returns the Unicode number of the first character of text.',
    args: {
      text: 'The text to read.',
    },
  },
  ENCODEURL: {
    summary: 'Encodes text for use in a web address.',
    args: {
      text: 'The text to encode.',
    },
  },
  ASC: {
    summary: 'Changes full-width characters to half-width. Returns the text unchanged where no region needs it.',
    args: {
      text: 'The text to change.',
    },
  },
  DBCS: {
    summary: 'Changes half-width characters to full-width. Returns the text unchanged where no region needs it.',
    args: {
      text: 'The text to change.',
    },
  },
  PHONETIC: {
    summary: 'Returns the text of a value. No phonetic readings are kept.',
    args: {
      reference: 'The value to read.',
    },
  },
  TEXT: {
    summary: 'Formats a value with a number format code and returns text.',
    args: {
      value: 'The value to format.',
      format_text: 'The format code, such as "#,##0.00" or "yyyy-mm-dd".',
    },
  },
  VALUE: {
    summary: 'Reads text as a number.',
    args: {
      text: 'The text to read, such as "$1,000" or "12%".',
    },
  },
  NUMBERVALUE: {
    summary: 'Reads text as a number with separators you choose.',
    args: {
      text: 'The text to read.',
      decimal_separator: 'The decimal mark. The default is a period.',
      group_separator: 'The digit group mark. The default is a comma.',
    },
  },
  DOLLAR: {
    summary: 'Formats a number as dollars, with negative amounts in brackets.',
    args: {
      number: 'The number to format.',
      decimals: 'Digits after the decimal mark. The default is 2. A negative number rounds to the left.',
    },
  },
  FIXED: {
    summary: 'Formats a number with a fixed number of decimals.',
    args: {
      number: 'The number to format.',
      decimals: 'Digits after the decimal mark. The default is 2. A negative number rounds to the left.',
      no_commas: 'TRUE leaves out the digit group marks.',
    },
  },
  BAHTTEXT: {
    summary: 'Writes a number as Thai words for baht and satang.',
    args: {
      number: 'The amount.',
    },
  },
  TEXTBEFORE: {
    summary: 'Returns the text before a delimiter.',
    args: {
      text: 'The text to search.',
      delimiter: 'The text to find, or an array of choices.',
      instance_num: 'Which match to use. A negative number counts from the end. The default is 1.',
      match_mode: '0 matches case, 1 does not.',
      match_end: '1 treats the end of the text as a delimiter.',
      if_not_found: 'What to return when there is no match. The default is #N/A.',
    },
  },
  TEXTAFTER: {
    summary: 'Returns the text after a delimiter.',
    args: {
      text: 'The text to search.',
      delimiter: 'The text to find, or an array of choices.',
      instance_num: 'Which match to use. A negative number counts from the end. The default is 1.',
      match_mode: '0 matches case, 1 does not.',
      match_end: '1 treats the end of the text as a delimiter.',
      if_not_found: 'What to return when there is no match. The default is #N/A.',
    },
  },
  TEXTSPLIT: {
    summary: 'Splits text into columns and rows at delimiters.',
    args: {
      text: 'The text to split.',
      col_delimiter: 'Where to split into columns.',
      row_delimiter: 'Where to split into rows.',
      ignore_empty: 'TRUE skips empty pieces.',
      match_mode: '0 matches case, 1 does not.',
      pad_with: 'What fills short rows. The default is #N/A.',
    },
  },
  TEXTJOIN: {
    summary: 'Joins text with a delimiter between the pieces.',
    args: {
      delimiter: 'The text between pieces, or an array to cycle through.',
      ignore_empty: 'TRUE skips empty pieces.',
      text: 'A value or range to join.',
    },
  },
  JOIN: {
    summary: 'Joins values with a delimiter between them.',
    args: {
      delimiter: 'The text between values.',
      value: 'A value or range to join.',
    },
  },
  SPLIT: {
    summary: 'Splits text into a row of pieces.',
    args: {
      text: 'The text to split.',
      delimiter: 'The characters to split at.',
      split_by_each: 'TRUE treats each character of the delimiter as its own. The default is TRUE.',
      remove_empty: 'TRUE drops empty pieces. The default is TRUE.',
    },
  },
  ARRAYTOTEXT: {
    summary: 'Writes an array as text.',
    args: {
      array: 'The array or range to write.',
      format: '0 is short, 1 is strict, with quotes and braces.',
    },
  },
  VALUETOTEXT: {
    summary: 'Writes a value as text.',
    args: {
      value: 'The value to write.',
      format: '0 is short, 1 is strict, with quotes around text.',
    },
  },
  REGEXTEST: {
    summary: 'Tells whether text matches a regular expression. A pattern can have at most 1,000 characters.',
    args: {
      text: 'The text to test.',
      pattern: 'The regular expression, at most 1,000 characters.',
      case_sensitivity: '0 matches case, 1 does not.',
    },
  },
  REGEXMATCH: {
    summary: 'Tells whether text matches a regular expression. A pattern can have at most 1,000 characters.',
    args: {
      text: 'The text to test.',
      pattern: 'The regular expression, at most 1,000 characters.',
    },
  },
  REGEXEXTRACT: {
    summary: 'Pulls matching text out of text. Mode 2 returns the capturing groups.',
    args: {
      text: 'The text to search.',
      pattern: 'The regular expression, at most 1,000 characters.',
      return_mode: '0 is the first match, 1 is all matches, 2 is the groups of the first match.',
      case_sensitivity: '0 matches case, 1 does not.',
    },
  },
  REGEXREPLACE: {
    summary:
      'Replaces text that matches a pattern of at most 1,000 characters. Use $1 for a group and $$ for a dollar sign.',
    args: {
      text: 'The text to change.',
      pattern: 'The regular expression, at most 1,000 characters.',
      replacement: 'The text to put in.',
      occurrence: 'Which match to replace. 0 is all, and a negative number counts from the end.',
      case_sensitivity: '0 matches case, 1 does not.',
    },
  },
  regexPatternTooLong: 'A regular expression can have at most 1,000 characters.',
  regexInputTooLong: 'Text matched by a regular expression can have at most 32,768 characters.',
} as const;
