// SQLite's messages (DESIGN 7.2). The texts are the error strings of the SQLite C source and the "Result and error
// codes" documentation, which sqlite3_errmsg returns and the WebAssembly build passes through unchanged.

import { entry, type CatalogEntry } from './types';

export const SQLITE_ENTRIES: readonly CatalogEntry[] = [
  entry('sqNoTable', /^no such table: (?<name>.+)/, ['no such table: users', 'no such table: main.orders']),
  entry('sqNoColumn', /^no such column: (?<name>.+)/, ['no such column: nmae', 'no such column: u.email']),
  entry('sqNoFunction', /^no such function: (?<name>.+)/, ['no such function: lenght']),
  entry('sqNoIndex', /^no such index: (?<name>.+)/, ['no such index: idx_name']),
  entry('sqSyntaxNear', /^near "(?<token>[^"]*)": syntax error/, [
    'near "FORM": syntax error',
    'near "(": syntax error',
  ]),
  entry('sqIncomplete', /^incomplete input/, ['incomplete input']),
  entry('sqUnrecognizedToken', /^unrecognized token: "(?<token>[^"]*)"/, ['unrecognized token: "\'abc"']),
  entry('sqUnique', /^UNIQUE constraint failed: (?<name>.+)/, ['UNIQUE constraint failed: users.email']),
  entry('sqNotNull', /^NOT NULL constraint failed: (?<name>.+)/, ['NOT NULL constraint failed: users.name']),
  entry('sqForeignKey', /^FOREIGN KEY constraint failed/, ['FOREIGN KEY constraint failed']),
  entry('sqCheck', /^CHECK constraint failed: (?<name>.+)/, ['CHECK constraint failed: age_positive']),
  entry('sqTableExists', /^(?:table|index|view) (?<name>.+) already exists/, ['table users already exists']),
  entry('sqDuplicateColumn', /^duplicate column name: (?<name>.+)/, ['duplicate column name: email']),
  entry('sqAmbiguousColumn', /^ambiguous column name: (?<name>.+)/, ['ambiguous column name: id']),
  entry(
    'sqValueCount',
    new RegExp(
      String.raw`^(?:table (?<table>\S+) has (?<columns>\d+) columns? but (?<values>\d+) values? (?:was|were) supplied` +
        String.raw`|(?<count>\d+) values for (?<cols>\d+) columns)`,
    ),
    ['table users has 3 columns but 2 values were supplied', '2 values for 3 columns'],
  ),
  entry('sqWrongArguments', /^wrong number of arguments to function (?<name>[^()]+)\(\)/, [
    'wrong number of arguments to function round()',
  ]),
  entry('sqAggregate', /^misuse of aggregate(?: function)?:? (?<name>[^\s]*)/, [
    'misuse of aggregate: sum()',
    'misuse of aggregate function count()',
  ]),
  entry('sqSystemTable', /^table (?<name>\S+) may not be modified/, ['table sqlite_master may not be modified']),
  entry('sqDatatype', /^datatype mismatch/, ['datatype mismatch']),
  entry('sqLocked', /^database (?:table )?is locked/, ['database is locked', 'database table is locked']),
  entry('sqReadonly', /^attempt to write a readonly database/, ['attempt to write a readonly database']),
  entry(
    'sqTransaction',
    /^cannot (?:start a transaction within a transaction|commit - no transaction is active|rollback - no transaction is active)/,
    ['cannot start a transaction within a transaction', 'cannot commit - no transaction is active'],
  ),
  entry('sqMalformed', /^database disk image is malformed|^file is not a database/, [
    'database disk image is malformed',
    'file is not a database',
  ]),
  entry(
    'sqOrderTerm',
    /^(?:(?<n>\d+)(?:st|nd|rd|th) ORDER BY term does not match any column in the result set|(?<which>ORDER|GROUP) BY term out of range)/,
    [
      '1st ORDER BY term does not match any column in the result set',
      'ORDER BY term out of range - should be between 1 and 2',
    ],
  ),
  entry('sqGeneric', /^(?:SQLITE_\w+|sqlite3\.\w+Error|Error)\b/, ['SQLITE_ERROR', 'SQLITE_CONSTRAINT']),
];
