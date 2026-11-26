// The generalized lockdown of a run worker (DESIGN 4.8), from the code cells' sandbox. Before the program runs,
// everything on the worker's global object and its prototypes goes. What stays: the JavaScript language, a few
// harmless helpers, what the runtime added while it loaded, and the extra names its adapter declares. A name on the
// FORBIDDEN list goes even when an adapter or a runtime asks to keep it. So no adapter can bring back the network,
// storage, other workers, timers, or code made from text.

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
  'SharedArrayBuffer',
  'Atomics',
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

/** Browser helpers runtimes call while a program runs. None reaches the network, storage, or another context. */
const HELPERS = ['WebAssembly', 'TextEncoder', 'TextDecoder', 'crypto', 'performance'];

/**
 * The names a run worker never keeps: the network, storage, files, other contexts, messages, timers, and the
 * worker's own handles. The code cells' lockdown probe checks the same list, and the run tests check it with
 * every adapter's allowances.
 */
export const FORBIDDEN = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'navigator',
  'location',
  'postMessage',
  'setTimeout',
  'setInterval',
  'eval',
  'Function',
  'self',
  'close',
  'Request',
  'Response',
  'Blob',
  'FileReader',
  'FileReaderSync',
  'URL',
  'OffscreenCanvas',
  'Notification',
  'addEventListener',
  'MessageChannel',
  'queueMicrotask',
  'structuredClone',
  'reportError',
  'console',
  'origin',
  'onmessage',
] as const;

/** The constructors that turn text into code. */
const MAKERS = [function () {}, async function () {}, function* () {}, async function* () {}];

function blocked(): never {
  throw new TypeError('Code cannot be made from text in a run.');
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
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
  } catch {
    return true;
  }
}

/** The names lockDown keeps: language, helpers, what the runtime added, and the adapter's allowances. */
export function keptNames(added: Iterable<string>, allowances: Iterable<string> = []): Set<string> {
  const keep = new Set([...LANGUAGE, ...HELPERS, ...added, ...allowances]);
  for (const name of FORBIDDEN) keep.delete(name);
  return keep;
}

/**
 * Removes every global outside the kept set from `scope` and its prototypes, and stops code being made from text.
 * Returns the names that could not be removed and still hold something, which must be none for a run to start.
 */
export function lockDown(scope: object, added: Iterable<string>, allowances: Iterable<string> = []): string[] {
  const keep = keptNames(added, allowances);
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
