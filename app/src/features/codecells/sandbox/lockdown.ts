// Takes the browser away from a sandbox worker before a cell runs (docs/help/code-cells.md; the threat note is in
// the lane's notes). Everything on the worker's global object and its prototypes goes, except the JavaScript language
// itself, a few harmless helpers the runtimes call, and what the runtime added while it loaded. So the cell has no
// fetch, sockets, storage, file system, further workers, or messages to anyone but this file's caller. Code cannot be
// made from text either (eval, Function, string timers), so nothing can reach import() or bring an API back.

/** The ECMAScript globals, which hold no way out. */
const LANGUAGE = [
  'globalThis',
  'undefined',
  'NaN',
  'Infinity',
  'isNaN',
  'isFinite',
  'parseInt',
  'parseFloat',
  'encodeURI',
  'encodeURIComponent',
  'decodeURI',
  'decodeURIComponent',
  'escape',
  'unescape',
  'Object',
  'Array',
  'Number',
  'String',
  'Boolean',
  'Symbol',
  'BigInt',
  'Math',
  'JSON',
  'Date',
  'RegExp',
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'FinalizationRegistry',
  'Promise',
  'Proxy',
  'Reflect',
  'Iterator',
  'ArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'Intl',
];

/**
 * Browser helpers the runtimes call while a cell runs: WebAssembly itself, text decoding, random numbers, and the
 * clock. None reaches the network, storage, or another context.
 */
const HELPERS = ['WebAssembly', 'TextEncoder', 'TextDecoder', 'crypto', 'performance'];

/** The constructors that turn text into code. */
const MAKERS = [function () {}, async function () {}, function* () {}, async function* () {}];

function blocked(): never {
  throw new TypeError('Code cannot be made from text in a code cell.');
}

/** The string keys on `scope` and its prototypes, for telling later what a runtime added. */
export function globalNames(scope: object = globalThis): Set<string> {
  const names = new Set<string>();
  for (
    let target: object | null = scope;
    target && target !== Object.prototype;
    target = Object.getPrototypeOf(target)
  ) {
    for (const key of Reflect.ownKeys(target)) if (typeof key === 'string') names.add(key);
  }
  return names;
}

function remove(target: object, key: PropertyKey): void {
  if (Reflect.deleteProperty(target, key)) return;
  // Not configurable: leave it empty instead, where that is allowed.
  try {
    Reflect.defineProperty(target, key, { value: undefined, writable: false });
  } catch {
    // Nothing more can be done to it; lockDown reports what stays.
  }
}

/** Whether a key left on `target` still gives the global an object or a function. */
function holds(scope: object, target: object, key: string): boolean {
  try {
    const value: unknown = Reflect.get(target, key, scope);
    // Constants such as TEMPORARY are numbers that cannot be removed, and give nothing.
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
  } catch {
    return true;
  }
}

/**
 * Removes every global outside the allowed set from `scope` and its prototypes, and stops code being made from text.
 * `added` names what the runtime put on the global while it loaded, which it still needs. Returns the names that could
 * not be removed and still hold something, which the tests expect to be none.
 */
export function lockDown(scope: object, added: ReadonlySet<string>): string[] {
  const keep = new Set([...LANGUAGE, ...HELPERS, ...added]);
  const chain: object[] = [];
  for (
    let target: object | null = scope;
    target && target !== Object.prototype;
    target = Object.getPrototypeOf(target)
  ) {
    chain.push(target);
  }
  for (const target of chain) {
    for (const key of Reflect.ownKeys(target)) {
      if (typeof key === 'string' && keep.has(key)) continue;
      remove(target, key);
    }
  }
  for (const maker of MAKERS) {
    Object.defineProperty(Object.getPrototypeOf(maker), 'constructor', { value: blocked, writable: false });
  }
  const left: string[] = [];
  for (const target of chain) {
    for (const key of Reflect.ownKeys(target)) {
      if (typeof key === 'string' && !keep.has(key) && holds(scope, target, key)) left.push(key);
    }
  }
  return left;
}
