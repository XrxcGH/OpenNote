// What a program sees besides the language: `console`, `print`, standard input, `process`, and a seeded
// `Math.random` (DESIGN 4.4, 4.5). The text below runs inside QuickJS, evaluated as the file "<environment>", and is
// called with host functions: write(stream, text), readLine() (a line, or null at the end of input), exit(code), and
// random(). It returns `inspect`, which formats a value the way console.log shows it.
//
// console.log follows Node's documented format: strings as they are, other values as `inspect` shows them
// ("[ 1, 2 ]", "{ a: 1, b: 'x' }", "[Function: f]", "Map(1) { 'a' => 1 }"). log, info, and debug write to standard
// output; warn, error, and trace write to standard error.

export const ENVIRONMENT = String.raw`(function (write, readLine, exit, random, argv) {
  'use strict';
  const MAX_ITEMS = 100;

  function quote(text) {
    return "'" + text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  }

  function keyText(key) {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key);
  }

  function inspect(value, depth, seen) {
    depth = depth || 0;
    seen = seen || [];
    if (typeof value === 'string') return depth === 0 ? value : quote(value);
    if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
    if (typeof value === 'bigint') return String(value) + 'n';
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') {
      const kind = /^class\b/.test(Function.prototype.toString.call(value)) ? 'class' : 'Function';
      return '[' + kind + (value.name ? (kind === 'class' ? ' ' : ': ') + value.name : ' (anonymous)') + ']';
    }
    if (value === null || typeof value !== 'object') return String(value);
    if (seen.indexOf(value) >= 0) return '[Circular]';
    if (value instanceof Error) {
      const head = value.name + ': ' + value.message;
      return value.stack ? head + '\n' + value.stack.replace(/\n$/, '') : head;
    }
    if (value instanceof Date) return isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    if (value instanceof RegExp) return String(value);
    if (depth > 2) return Array.isArray(value) ? '[Array]' : '[Object]';
    const inner = seen.concat([value]);
    const show = function (item) { return inspect(item, depth + 1, inner); };
    let parts;
    let open;
    let close;
    if (Array.isArray(value)) {
      parts = value.slice(0, MAX_ITEMS).map(show);
      for (let i = 0; i < Math.min(value.length, MAX_ITEMS); i++) if (!(i in value)) parts[i] = '<empty>';
      if (value.length > MAX_ITEMS) parts.push('... ' + (value.length - MAX_ITEMS) + ' more items');
      open = '[';
      close = ']';
    } else if (value instanceof Map) {
      parts = Array.from(value).slice(0, MAX_ITEMS).map(function (pair) { return show(pair[0]) + ' => ' + show(pair[1]); });
      open = 'Map(' + value.size + ') {';
      close = '}';
    } else if (value instanceof Set) {
      parts = Array.from(value).slice(0, MAX_ITEMS).map(show);
      open = 'Set(' + value.size + ') {';
      close = '}';
    } else {
      parts = Object.keys(value).slice(0, MAX_ITEMS).map(function (key) { return keyText(key) + ': ' + show(value[key]); });
      const proto = Object.getPrototypeOf(value);
      const name = proto && proto !== Object.prototype && proto.constructor ? proto.constructor.name : '';
      open = (proto === null ? '[Object: null prototype] ' : name ? name + ' ' : '') + '{';
      close = '}';
    }
    if (parts.length === 0) return open + close;
    const line = open + ' ' + parts.join(', ') + ' ' + close;
    if (line.length <= 72 && line.indexOf('\n') < 0) return line;
    const pad = '  '.repeat(depth + 1);
    return open + '\n' + parts.map(function (part) { return pad + part; }).join(',\n') + '\n' + '  '.repeat(depth) + close;
  }

  let indent = '';
  const counts = Object.create(null);
  const timers = Object.create(null);
  function writer(stream) {
    return function () {
      const text = Array.prototype.map.call(arguments, function (arg) { return inspect(arg); }).join(' ');
      write(stream, (indent ? text.split('\n').map(function (line) { return indent + line; }).join('\n') : text) + '\n');
    };
  }
  const log = writer('out');
  const err = writer('err');
  const console = {
    log: log,
    info: log,
    debug: log,
    warn: err,
    error: err,
    trace: function () {
      err.apply(null, ['Trace:'].concat(Array.prototype.slice.call(arguments)));
    },
    assert: function (condition) {
      if (condition) return;
      const rest = Array.prototype.slice.call(arguments, 1);
      err.apply(null, ['Assertion failed' + (rest.length ? ':' : '')].concat(rest));
    },
    group: function () {
      if (arguments.length) log.apply(null, arguments);
      indent += '  ';
    },
    groupEnd: function () {
      indent = indent.slice(2);
    },
    count: function (label) {
      const key = label === undefined ? 'default' : String(label);
      counts[key] = (counts[key] || 0) + 1;
      log(key + ': ' + counts[key]);
    },
    countReset: function (label) {
      counts[label === undefined ? 'default' : String(label)] = 0;
    },
    time: function (label) {
      timers[label === undefined ? 'default' : String(label)] = Date.now();
    },
    timeEnd: function (label) {
      const key = label === undefined ? 'default' : String(label);
      if (key in timers) log(key + ': ' + (Date.now() - timers[key]) + 'ms');
      delete timers[key];
    },
  };
  globalThis.console = console;
  globalThis.print = log;
  globalThis.readline = function () { return readLine(); };
  globalThis.prompt = function (message) {
    if (message !== undefined) write('out', String(message));
    return readLine();
  };
  globalThis.process = {
    argv: JSON.parse(argv),
    env: {},
    platform: 'opennote',
    exit: function (code) { exit(code === undefined ? 0 : Number(code) | 0); },
    stdout: { write: function (text) { write('out', String(text)); return true; } },
    stderr: { write: function (text) { write('err', String(text)); return true; } },
  };
  Object.defineProperty(Math, 'random', { value: function () { return random(); }, writable: true, configurable: true });
  return inspect;
})`;
