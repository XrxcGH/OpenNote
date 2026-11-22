// JavaScript's errors (DESIGN 7.2). The messages are the ones V8 prints (QuickJS words a few of them alike); the
// sentences follow MDN's reference pages for each error.

import { entry, type CatalogEntry } from './types';

export const JAVASCRIPT_ENTRIES: readonly CatalogEntry[] = [
  entry('jsNotDefined', /^ReferenceError: (?<name>[^\s]+) is not defined/, [
    'ReferenceError: total is not defined',
    'ReferenceError: x is not defined',
  ]),
  entry(
    'jsBeforeInit',
    /^ReferenceError: (?:Cannot access '(?<name>[^']+)' before initialization|(?<other>\S+) is not initialized)/,
    ["ReferenceError: Cannot access 'count' before initialization"],
  ),
  entry('jsNotFunction', /^TypeError: (?<name>.+?) is not a function/, [
    'TypeError: obj.run is not a function',
    'TypeError: items.map(...).filter is not a function',
  ]),
  entry(
    'jsReadUndefined',
    /^TypeError: Cannot read propert(?:y|ies) of (?<what>undefined|null) \(reading '(?<name>[^']+)'\)/,
    [
      "TypeError: Cannot read properties of undefined (reading 'name')",
      "TypeError: Cannot read properties of null (reading 'length')",
    ],
  ),
  entry(
    'jsSetUndefined',
    /^TypeError: Cannot set propert(?:y|ies) of (?<what>undefined|null) \(setting '(?<name>[^']+)'\)/,
    ["TypeError: Cannot set properties of undefined (setting 'x')"],
  ),
  entry('jsConstAssign', /^TypeError: Assignment to constant variable/, [
    'TypeError: Assignment to constant variable.',
  ]),
  entry('jsNotIterable', /^TypeError: (?<name>.+?) is not iterable/, [
    'TypeError: obj is not iterable',
    'TypeError: undefined is not iterable (cannot read property Symbol(Symbol.iterator))',
  ]),
  entry(
    'jsDestructure',
    /^TypeError: Cannot destructure property '(?<name>[^']+)' of '(?<source>[^']+)' as it is (?<what>undefined|null)/,
    ["TypeError: Cannot destructure property 'a' of 'b' as it is undefined."],
  ),
  entry('jsNotConstructor', /^TypeError: (?<name>.+?) is not a constructor/, ['TypeError: Math is not a constructor']),
  entry('jsClassNew', /^TypeError: Class constructor (?<name>\S+) cannot be invoked without 'new'/, [
    "TypeError: Class constructor Cat cannot be invoked without 'new'",
  ]),
  entry('jsStackOverflow', /^RangeError: Maximum call stack size exceeded/, [
    'RangeError: Maximum call stack size exceeded',
  ]),
  entry('jsArrayLength', /^RangeError: Invalid array length/, ['RangeError: Invalid array length']),
  entry(
    'jsInvalidJson',
    /^SyntaxError: (?:Unexpected token .* in JSON|JSON\.parse|Unexpected end of JSON input|Expected .* in JSON)/,
    ['SyntaxError: Unexpected token < in JSON at position 0', 'SyntaxError: Unexpected end of JSON input'],
  ),
  entry('jsAlreadyDeclared', /^SyntaxError: Identifier '(?<name>[^']+)' has already been declared/, [
    "SyntaxError: Identifier 'x' has already been declared",
  ]),
  entry('jsMissingInitializer', /^SyntaxError: Missing initializer in (?<kind>const|destructuring) declaration/, [
    'SyntaxError: Missing initializer in const declaration',
  ]),
  entry('jsUnexpectedEnd', /^SyntaxError: Unexpected end of input/, ['SyntaxError: Unexpected end of input']),
  entry('jsUnexpectedIdentifier', /^SyntaxError: Unexpected identifier(?: '(?<name>[^']+)')?/, [
    'SyntaxError: Unexpected identifier',
    "SyntaxError: Unexpected identifier 'y'",
  ]),
  entry(
    'jsUnexpectedToken',
    /^SyntaxError: Unexpected (?:token|string|number|template string|reserved word)(?: '?(?<token>[^'\n]+)'?)?/,
    ["SyntaxError: Unexpected token '}'", "SyntaxError: Unexpected token ')'", 'SyntaxError: Unexpected string'],
  ),
  entry('jsInvalidToken', /^SyntaxError: Invalid or unexpected token/, ['SyntaxError: Invalid or unexpected token']),
  entry('jsAwaitOutside', /^SyntaxError: await is only valid in async functions/, [
    'SyntaxError: await is only valid in async functions and the top level bodies of modules',
  ]),
  entry('jsClassTypeError', /^TypeError(?::|$)/, ['TypeError: example']),
  entry('jsClassRangeError', /^RangeError(?::|$)/, ['RangeError: Invalid count value: -1']),
  entry('jsClassSyntaxError', /^SyntaxError(?::|$)/, ['SyntaxError: example']),
  entry('jsClassReferenceError', /^ReferenceError(?::|$)/, ['ReferenceError: example']),
  entry('jsClassUriError', /^URIError(?::|$)/, ['URIError: URI malformed']),
  entry('jsClassError', /^(?:Eval|Internal)?Error(?::|$)/, [
    'Error: example',
    'Error: setup',
    'InternalError: out of memory',
  ]),
];
