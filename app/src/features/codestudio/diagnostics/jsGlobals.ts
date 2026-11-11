// Names a JavaScript program may use without declaring them: the value properties, functions, and constructors of
// the global object in the ECMAScript 2024 specification (section 19), plus the host names the app's runtimes give
// (console, timers, text encoding, URLs, and the like). no-undef accepts these.

const ECMASCRIPT =
  'globalThis Infinity NaN undefined eval isFinite isNaN parseFloat parseInt decodeURI decodeURIComponent ' +
  'encodeURI encodeURIComponent escape unescape AggregateError Array ArrayBuffer BigInt BigInt64Array ' +
  'BigUint64Array Boolean DataView Date Error EvalError FinalizationRegistry Float32Array Float64Array Function ' +
  'Int8Array Int16Array Int32Array Map Number Object Promise Proxy RangeError ReferenceError RegExp Set ' +
  'SharedArrayBuffer String Symbol SyntaxError TypeError Uint8Array Uint8ClampedArray Uint16Array Uint32Array ' +
  'URIError WeakMap WeakRef WeakSet Atomics JSON Math Reflect Intl';

const HOST =
  'console setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone TextEncoder ' +
  'TextDecoder URL URLSearchParams atob btoa performance crypto prompt alert';

/** The Jest-compatible test API the app injects into JavaScript and TypeScript programs (ADR 0075). */
const TEST_API = 'describe it test expect beforeEach afterEach beforeAll afterAll';

export const JS_GLOBALS: ReadonlySet<string> = new Set(`${ECMASCRIPT} ${HOST} ${TEST_API}`.split(' '));
