// Explanations for the catalog entries of code:L11 (SQLite messages and Lua errors).
// Each has what happened, the likely cause, and what to try.

export const explainDatabase = {
  sqNoTable: {
    what: 'There is no table named {name}.',
    cause: 'The name is misspelled, or the table was never created in this database.',
    next: 'Check the spelling. Run the CREATE TABLE statement first.',
  },
  sqNoColumn: {
    what: 'There is no column named {name}.',
    cause: 'The name is misspelled, or the column is in another table.',
    next: "Check the spelling against the table's columns. Add the table name before it if two tables" + ' share it.',
  },
  sqNoFunction: {
    what: 'There is no function named {name}.',
    cause: 'SQLite does not have a function with this name.',
    next: 'Check the spelling. Use length() for text length, and see the list of functions.',
  },
  sqNoIndex: {
    what: 'There is no index named {name}.',
    cause: 'The index was never created or is misspelled.',
    next: 'Check the name, or create it first.',
  },
  sqSyntaxNear: {
    what: 'SQLite cannot read the statement near {token}.',
    cause: 'The word before or at {token} is probably misspelled or in the wrong order.',
    next: 'Check keywords such as SELECT, FROM, WHERE, and the commas between columns.',
  },
  sqIncomplete: {
    what: 'The statement stops too early.',
    cause: 'A bracket, quote, or clause is missing at the end.',
    next: 'Check the closing bracket and the quote. End the statement with a semicolon.',
  },
  sqUnrecognizedToken: {
    what: 'A character in the statement is not valid.',
    cause: 'A quote may be unclosed or a character came from a document.',
    next: 'Use straight quotes and close them.',
  },
  sqUnique: {
    what: 'A value that must be unique already exists in {name}.',
    cause: 'A UNIQUE or PRIMARY KEY column cannot hold the same value twice.',
    next: 'Use a different value, or update the existing row.',
  },
  sqNotNull: {
    what: 'The column {name} must have a value.',
    cause: 'The column is marked NOT NULL, but the row has no value for it.',
    next: 'Give the column a value in the INSERT.',
  },
  sqForeignKey: {
    what: 'A row refers to a row that does not exist.',
    cause: 'A foreign key must match a row in the other table.',
    next: 'Add the other row first, or fix the value.',
  },
  sqCheck: {
    what: 'A value broke a CHECK rule: {name}.',
    cause: 'The column or table has a rule, and the value does not satisfy it.',
    next: 'Look at the CHECK in CREATE TABLE and use a value that passes.',
  },
  sqTableExists: {
    what: 'The name {name} is taken.',
    cause: 'Something with this name already exists in the database.',
    next: 'Use CREATE TABLE IF NOT EXISTS, or DROP the old one first.',
  },
  sqDuplicateColumn: {
    what: 'The column {name} appears twice.',
    cause: 'Each column in a table needs its own name.',
    next: 'Rename or remove one.',
  },
  sqAmbiguousColumn: {
    what: 'The column {name} is in more than one table.',
    cause: 'SQLite cannot tell which one you mean.',
    next: 'Write the table name first, such as users.id.',
  },
  sqValueCount: {
    what: 'The number of values does not match the columns.',
    cause: 'The INSERT gives a different number of values than columns.',
    next: 'Count both, or name the columns after the table.',
  },
  sqWrongArguments: {
    what: 'The function {name} got the wrong number of arguments.',
    cause: 'Each function takes a fixed number or range of values.',
    next: "Check the function's definition.",
  },
  sqAggregate: {
    what: 'An aggregate is used where it is not allowed.',
    cause: 'sum(), count(), and similar cannot go in a WHERE clause.',
    next: 'Use HAVING after GROUP BY, or a subquery.',
  },
  sqDatatype: {
    what: 'The value does not fit the column type.',
    cause: 'A column such as INTEGER PRIMARY KEY accepts only whole numbers.',
    next: 'Use a value of the right type.',
  },
  sqLocked: {
    what: 'The database is busy.',
    cause: 'Another statement is using it.',
    next: 'Wait, and run it again.',
  },
  sqReadonly: {
    what: 'The database cannot be changed.',
    cause: 'It was opened for reading only.',
    next: 'Open a writable copy.',
  },
  sqTransaction: {
    what: 'The transaction state is wrong.',
    cause: 'BEGIN was run twice, or COMMIT or ROLLBACK ran with no BEGIN.',
    next: 'Match each BEGIN with one COMMIT or ROLLBACK.',
  },
  sqMalformed: {
    what: 'The database file is damaged or not a database.',
    cause: 'The file is not valid SQLite data.',
    next: 'Create a new database, or use a good copy.',
  },
  sqOrderTerm: {
    what: 'The ordering refers to a column that does not exist.',
    cause: 'ORDER BY and GROUP BY positions must match columns in the result.',
    next: 'Use a column name, or a position from 1 to the number of columns.',
  },
  sqGeneric: {
    what: 'SQLite reported an error.',
    cause: 'The code names the kind of failure.',
    next: 'Read the message after it for the reason.',
  },
  luaIndexNil: {
    what: 'The code reads a field of a {type} value.',
    cause:
      'The name before the dot or bracket holds {type}, not a table. A misspelled name or a ' +
      'variable that was never set is the usual cause.',
    next: 'Print the name before the dot. Check the spelling, and set it before this line.',
  },
  luaCallNil: {
    what: 'The code calls a {type} value.',
    cause: 'The name with parentheses after it holds {type}. It may be misspelled, or defined later in' + ' the file.',
    next: 'Check the spelling. Define the function above the call.',
  },
  luaArithmetic: {
    what: 'A {type} value is used in arithmetic.',
    cause: '+ - * / need numbers. The value is {type}, often an unset variable, or text that is not a number.',
    next: 'Print the value. Use tonumber() for text.',
  },
  luaConcat: {
    what: 'A {type} value is joined to text with the dots.',
    cause: '.. joins text and numbers only.',
    next: 'Use tostring() first.',
  },
  luaCompare: {
    what: 'Two values of different types are compared.',
    cause: '< and > work on two numbers or two strings, not mixed ones, nil, or tables.',
    next: 'Convert one side, or check for nil.',
  },
  luaLength: {
    what: 'A {type} value has no length.',
    cause: 'The # sign works on text and tables only.',
    next: 'Print the value, and check that it is set.',
  },
  luaBadArgument: {
    what: 'A function got a wrong argument.',
    cause: 'Argument {n} of {fn} did not fit: {detail}.',
    next: 'Check the type and value passed in position {n}.',
  },
  luaStackOverflow: {
    what: 'A function called itself too many times.',
    cause: 'There is no stopping case.',
    next: 'Add a base case that returns.',
  },
  luaDivideZero: {
    what: 'The code divides a whole number by zero.',
    cause: '// and % with whole numbers cannot use 0 as the divisor.',
    next: 'Check the divisor first.',
  },
  luaNoInteger: {
    what: 'A decimal was used where a whole number is needed.',
    cause: 'The value has a fractional part.',
    next: 'Use math.floor or math.tointeger first.',
  },
  luaExpected: {
    what: 'The code expects {token} here.',
    cause: 'A word or symbol that finishes the statement is missing, near {near}.',
    next: 'Add {token}. Check that each if, for, while, and function has its end.',
  },
  luaUnexpectedSymbol: {
    what: 'A symbol is not allowed here.',
    cause: 'The symbol near {near} does not fit the grammar.',
    next: 'Check the line and the one above it.',
  },
  luaUnfinishedString: {
    what: 'A string is not closed.',
    cause: 'A quote opened and the line ended.',
    next: 'Add the closing quote.',
  },
  luaMalformedNumber: {
    what: 'A number is not written correctly.',
    cause: 'The text near {near} starts like a number but has extra letters.',
    next: 'Fix the number, or put it in quotes.',
  },
} as const;
