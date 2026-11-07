// Number format codes and their names.
// Owner: tables:numfmt (B9). shared:x-shared registered it in the string index, and the owner fills it in.

export const numfmt = {
  /** The Number format menu (DESIGN.md section 9). */
  category: {
    general: 'General',
    number: 'Number',
    currency: 'Currency',
    accounting: 'Accounting',
    shortDate: 'Short date',
    longDate: 'Long date',
    time: 'Time',
    percent: 'Percent',
    fraction: 'Fraction',
    scientific: 'Scientific',
    text: 'Text',
    more: 'More formats',
  },
  /** Why a typed format code can't be used. */
  error: {
    sections: 'A format code can have at most 4 sections.',
    quote: 'A quote in this format code has no closing quote.',
    bracket: 'A bracket in this format code has no closing bracket.',
    escape: 'This format code ends with a character that needs one more after it.',
    condition: 'A condition in this format code needs a number, such as [>100].',
  },
  /** The eight named format colors. */
  color: {
    black: 'Black',
    white: 'White',
    red: 'Red',
    green: 'Green',
    blue: 'Blue',
    yellow: 'Yellow',
    magenta: 'Magenta',
    cyan: 'Cyan',
  },
} as const;
