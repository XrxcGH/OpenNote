// Lua's errors (DESIGN 7.2). The messages are Lua 5.4's, from the runtime (ldebug.c, lauxlib.c) and the parser
// (llex.c, lparser.c). The cleaned message has no `file:line:` prefix.

import { entry, type CatalogEntry } from './types';

export const LUA_ENTRIES: readonly CatalogEntry[] = [
  entry(
    'luaIndexNil',
    /^attempt to index a (?<type>nil|number|boolean|string|function) value(?: \((?<kind>[a-z]+) '(?<name>[^']+)'\))?/,
    [
      "attempt to index a nil value (global 'config')",
      "attempt to index a nil value (field 'items')",
      "attempt to index a number value (local 'n')",
    ],
  ),
  entry(
    'luaCallNil',
    /^attempt to call a (?<type>nil|number|boolean|string|table) value(?: \((?<kind>[a-z]+) '(?<name>[^']+)'\))?/,
    [
      "attempt to call a nil value (global 'prnt')",
      "attempt to call a nil value (method 'add')",
      'attempt to call a table value',
    ],
  ),
  entry(
    'luaArithmetic',
    /^attempt to perform arithmetic on a (?<type>\w+) value(?: \((?<kind>[a-z]+) '(?<name>[^']+)'\))?/,
    [
      "attempt to perform arithmetic on a nil value (local 'x')",
      "attempt to perform arithmetic on a string value (constant 'a')",
    ],
  ),
  entry('luaConcat', /^attempt to concatenate a (?<type>\w+) value(?: \((?<kind>[a-z]+) '(?<name>[^']+)'\))?/, [
    "attempt to concatenate a nil value (local 'name')",
    "attempt to concatenate a table value (global 't')",
  ]),
  entry('luaCompare', /^attempt to compare (?:(?<a>\w+) with (?<b>\w+)|two (?<same>\w+) values)/, [
    'attempt to compare number with nil',
    'attempt to compare two table values',
  ]),
  entry('luaLength', /^attempt to get length of a (?<type>\w+) value(?: \((?<kind>[a-z]+) '(?<name>[^']+)'\))?/, [
    "attempt to get length of a nil value (local 'list')",
  ]),
  entry('luaBadArgument', /^bad argument #(?<n>\d+) to '(?<fn>[^']+)' \((?<detail>.+)\)/, [
    "bad argument #1 to 'insert' (table expected, got nil)",
    "bad argument #2 to 'format' (number expected, got string)",
  ]),
  entry('luaStackOverflow', /^stack overflow/, ['stack overflow (message truncated)', 'stack overflow']),
  entry('luaDivideZero', /^attempt to perform 'n(?:\/\/|%%?)0'/, [
    "attempt to perform 'n//0'",
    "attempt to perform 'n%%0'",
  ]),
  entry('luaNoInteger', /^number has no integer representation/, ['number has no integer representation']),
  entry(
    'luaExpected',
    /^'(?<token>[^']+)' expected(?: \(to close '(?<open>[^']+)' at line (?<line>\d+)\))? near (?<near>.+)/,
    ["'=' expected near 'x'", "'end' expected (to close 'if' at line 1) near <eof>", "'then' expected near 'print'"],
  ),
  entry('luaUnexpectedSymbol', /^unexpected symbol near (?<near>.+)/, ["unexpected symbol near '+'"]),
  entry('luaUnfinishedString', /^unfinished string near (?<near>.+)/, ["unfinished string near '\"hello'"]),
  entry('luaMalformedNumber', /^malformed number near (?<near>.+)/, ["malformed number near '12abc'"]),
];
