// The test API inside QuickJS (DESIGN 9, ADR 0075): a Jest-compatible subset written from Jest's documented
// behavior. `describe`, `it`, `test`, `beforeEach`, `afterEach`, and `expect` with `.not` and the matchers DESIGN 9
// lists. The text below runs inside the sandbox, so it is JavaScript in a string, evaluated as the file "<test-api>".
// It is called with two host functions: `report(json)` sends one result, and `load(path)` runs one test file.
//
// Each rule below is from Jest's documentation.
//
// toBe compares two values by sameness. So NaN equals NaN, and zero differs from negative zero.
//
// toEqual ignores properties whose value is undefined. It also ignores undefined array items, array sparseness,
// and object types. toStrictEqual counts all of those.
//
// toBeCloseTo(n, digits = 2) passes when |received - n| < 10^-digits / 2.
//
// toThrow(x) passes when the function throws. A string must be in the message. A regular expression must match
// the message. A class must be the error's class or a parent of it. An error must have the same message.
//
// afterEach hooks run from the innermost describe outward. beforeEach hooks run from the outermost inward.
//
// beforeAll runs once before the first test of its describe, and afterAll once after the last one. When a beforeAll
// fails, every test of its describe fails with that error. A test cannot start inside another test.
//
// `.only` and `.each` are not supported: they throw a clear error, so a file that uses them does not pass silently.
// The third argument is the text of those errors, from the strings file. The harness keeps its own JSON.stringify and
// Object.keys, so a program that replaces them cannot break the reports.

export const TEST_API = String.raw`(function (report, load, textJson) {
  'use strict';
  const text = JSON.parse(textJson);
  const stringify = JSON.stringify;
  const objectKeys = Object.keys;
  const ownSymbols = Object.getOwnPropertySymbols;
  const consoleError = console.error;
  function suiteIn(parent, titles) {
    return { titles, beforeEach: [], afterEach: [], beforeAll: [], afterAll: [], parent, started: false, failure: null };
  }
  const root = suiteIn(null, []);
  const tests = [];
  let current = root;
  let skipping = 0;
  let file = '';
  let running = false;
  let planned = 0;

  function outsideTests() {
    if (running) throw new Error(text.nested);
  }
  function addTest(name, fn, skip) {
    outsideTests();
    tests.push({
      titles: current.titles.concat(String(name)), fn, suite: current, file, skip: skip || skipping > 0, index: tests.length,
    });
  }
  function describe(name, fn) {
    outsideTests();
    const suite = suiteIn(current, current.titles.concat(String(name)));
    const saved = current;
    current = suite;
    try {
      fn();
    } finally {
      current = saved;
    }
  }
  describe.skip = function (name, fn) {
    skipping++;
    try {
      describe(name, fn);
    } finally {
      skipping--;
    }
  };
  function test(name, fn) {
    addTest(name, fn, false);
  }
  test.skip = function (name, fn) {
    addTest(name, fn, true);
  };
  test.todo = function (name) {
    addTest(name, undefined, true);
  };
  function it(name, fn) {
    addTest(name, fn, false);
  }
  it.skip = test.skip;
  it.todo = test.todo;
  function notSupported(name) {
    return function () { throw new Error(text.notSupported[name]); };
  }
  test.only = notSupported('test.only');
  test.each = notSupported('test.each');
  it.only = notSupported('it.only');
  it.each = notSupported('it.each');
  describe.only = notSupported('describe.only');
  describe.each = notSupported('describe.each');

  class AssertionError extends Error {}
  AssertionError.prototype.name = 'AssertionError';

  function format(value, depth) {
    depth = depth || 0;
    if (typeof value === 'string') return stringify(value);
    if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
    if (typeof value === 'bigint') return String(value) + 'n';
    if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
    if (typeof value !== 'object' || value === null) return String(value);
    if (depth > 3) return Array.isArray(value) ? '[Array]' : '[Object]';
    if (value instanceof Error) return value.name + ': ' + value.message;
    if (value instanceof Date) return 'Date(' + value.toISOString() + ')';
    if (value instanceof RegExp) return String(value);
    if (Array.isArray(value)) return '[' + value.map(function (item) { return format(item, depth + 1); }).join(', ') + ']';
    if (value instanceof Map) {
      return 'Map {' + Array.from(value).map(function (pair) {
        return format(pair[0], depth + 1) + ' => ' + format(pair[1], depth + 1);
      }).join(', ') + '}';
    }
    if (value instanceof Set) {
      return 'Set {' + Array.from(value).map(function (item) { return format(item, depth + 1); }).join(', ') + '}';
    }
    const keys = objectKeys(value);
    return '{' + keys.map(function (key) { return key + ': ' + format(value[key], depth + 1); }).join(', ') + '}';
  }

  const tag = function (value) { return Object.prototype.toString.call(value); };
  const has = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };

  function keysOf(object, strict) {
    const symbols = ownSymbols(object).filter(function (key) {
      return Object.prototype.propertyIsEnumerable.call(object, key);
    });
    return objectKeys(object).concat(symbols).filter(function (key) { return strict || object[key] !== undefined; });
  }
  const isIndex = function (key) { return typeof key === 'string' && String(key >>> 0) === key; };

  function equals(a, b, strict, seen) {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (tag(a) !== tag(b)) return false;
    if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (a instanceof Date) return Object.is(a.getTime(), b.getTime());
    if (a instanceof RegExp) return a.source === b.source && a.flags === b.flags;
    if (a instanceof Error) return a.message === b.message;
    if (a instanceof Number || a instanceof String || a instanceof Boolean) return Object.is(a.valueOf(), b.valueOf());
    for (let i = 0; i < seen.length; i++) if (seen[i][0] === a) return seen[i][1] === b;
    seen = seen.concat([[a, b]]);
    if (a instanceof Map) {
      if (a.size !== b.size) return false;
      for (const pair of a) {
        if (b.has(pair[0])) {
          if (!equals(pair[1], b.get(pair[0]), strict, seen)) return false;
          continue;
        }
        // A key that is an object or an array matches an equal key, as Jest compares Map keys.
        let matched = false;
        for (const other of b) {
          if (equals(pair[0], other[0], strict, seen) && equals(pair[1], other[1], strict, seen)) {
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      return true;
    }
    if (a instanceof Set) {
      if (a.size !== b.size) return false;
      const rest = Array.from(b);
      for (const item of a) {
        const index = rest.findIndex(function (other) { return equals(item, other, strict, seen); });
        if (index < 0) return false;
        rest.splice(index, 1);
      }
      return true;
    }
    if (Array.isArray(a)) {
      if (strict && a.length !== b.length) return false;
      const length = Math.max(a.length, b.length);
      for (let i = 0; i < length; i++) {
        if (strict && (i in a) !== (i in b)) return false;
        if (!equals(a[i], b[i], strict, seen)) return false;
      }
    }
    const ka = keysOf(a, strict).filter(function (key) { return !Array.isArray(a) || !isIndex(key); });
    const kb = keysOf(b, strict).filter(function (key) { return !Array.isArray(b) || !isIndex(key); });
    if (ka.length !== kb.length) return false;
    for (const key of ka) if (!has(b, key) || !equals(a[key], b[key], strict, seen)) return false;
    return true;
  }

  function thrownBy(fn) {
    if (typeof fn !== 'function') throw new TypeError('expect(received).toThrow(): received value must be a function');
    try {
      fn();
    } catch (error) {
      return { error };
    }
    return null;
  }

  function messageOf(error) {
    return error !== null && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  }

  const matchers = {
    toBe: function (r, e) { return { pass: Object.is(r, e), expected: e }; },
    toEqual: function (r, e) { return { pass: equals(r, e, false, []), expected: e }; },
    toStrictEqual: function (r, e) { return { pass: equals(r, e, true, []), expected: e }; },
    toBeTruthy: function (r) { return { pass: !!r }; },
    toBeFalsy: function (r) { return { pass: !r }; },
    toBeNull: function (r) { return { pass: r === null, expected: null }; },
    toBeUndefined: function (r) { return { pass: r === undefined, expected: undefined }; },
    toBeDefined: function (r) { return { pass: r !== undefined }; },
    toBeNaN: function (r) { return { pass: typeof r === 'number' && r !== r }; },
    toBeInstanceOf: function (r, e) { return { pass: r instanceof e, expected: e }; },
    toContain: function (r, e) {
      const pass = typeof r === 'string' ? r.includes(String(e)) : Array.from(r).some(function (item) { return item === e; });
      return { pass, expected: e };
    },
    toHaveLength: function (r, e) {
      return { pass: r !== null && r !== undefined && r.length === e, expected: e, actual: r === null || r === undefined ? r : r.length };
    },
    toMatch: function (r, e) {
      if (typeof r !== 'string') throw new TypeError('expect(received).toMatch(): received value must be a string');
      return { pass: typeof e === 'string' ? r.includes(e) : e.test(r), expected: e };
    },
    toBeCloseTo: function (r, e, digits) {
      const places = digits === undefined ? 2 : digits;
      const pass = (r === Infinity && e === Infinity) || (r === -Infinity && e === -Infinity) ||
        Math.abs(e - r) < Math.pow(10, -places) / 2;
      return { pass, expected: e };
    },
    toBeGreaterThan: function (r, e) { return { pass: r > e, expected: e }; },
    toBeGreaterThanOrEqual: function (r, e) { return { pass: r >= e, expected: e }; },
    toBeLessThan: function (r, e) { return { pass: r < e, expected: e }; },
    toBeLessThanOrEqual: function (r, e) { return { pass: r <= e, expected: e }; },
    toThrow: function (r, e) {
      const thrown = thrownBy(r);
      const actual = thrown ? thrown.error : undefined;
      let pass = thrown !== null;
      if (pass && e !== undefined) {
        const message = messageOf(actual);
        if (typeof e === 'string') pass = message.includes(e);
        else if (e instanceof RegExp) pass = e.test(message);
        else if (typeof e === 'function') pass = actual instanceof e;
        else pass = message === messageOf(e);
      }
      return { pass, expected: e, actual, thrown: thrown !== null };
    },
  };
  matchers.toThrowError = matchers.toThrow;

  function expect(received) {
    function bind(negated) {
      const bound = {};
      objectKeys(matchers).forEach(function (name) {
        bound[name] = function () {
          const args = Array.prototype.slice.call(arguments);
          const result = matchers[name].apply(null, [received].concat(args));
          if (result.pass !== negated) return;
          const shown = 'actual' in result ? result.actual : received;
          const shownArgs = args.map(function (arg) { return format(arg); }).join(', ');
          const lines = ['expect(received)' + (negated ? '.not.' : '.') + name + '(' + shownArgs + ')', ''];
          if ('expected' in result) lines.push('Expected: ' + (negated ? 'not ' : '') + format(result.expected));
          if (name === 'toThrow' || name === 'toThrowError') {
            lines.push(result.thrown ? 'Received error: ' + format(shown) : 'Received function did not throw');
          } else {
            lines.push('Received: ' + format(shown));
          }
          const error = new AssertionError(lines.join('\n'));
          error.expected = 'expected' in result ? format(result.expected) : undefined;
          error.actual = format(shown);
          throw error;
        };
      });
      return bound;
    }
    const matched = bind(false);
    matched.not = bind(true);
    return matched;
  }

  function chain(suite, key) {
    const hooks = [];
    for (let s = suite; s; s = s.parent) hooks.unshift.apply(hooks, s[key]);
    return key === 'afterEach' ? hooks.reverse() : hooks;
  }

  function call(fn) {
    if (fn.length === 0) return fn();
    return new Promise(function (resolve, reject) {
      fn(function (error) { if (error) reject(error); else resolve(); });
    });
  }

  function send(entry, status, started, failure) {
    const result = {
      name: entry.titles.join(' > '), file: entry.file, status, timeMs: Date.now() - started, index: entry.index,
    };
    if (failure !== undefined) {
      result.message = failure instanceof Error ? failure.name + ': ' + failure.message : 'Thrown: ' + format(failure);
      if (failure instanceof AssertionError) {
        result.message = failure.message;
        if (failure.expected !== undefined) result.expected = failure.expected;
        result.actual = failure.actual;
      }
      if (failure instanceof Error && failure.stack) result.stack = String(failure.stack);
    }
    report(stringify(result));
  }

  function suitesOf(entry) {
    const list = [];
    for (let s = entry.suite; s; s = s.parent) list.unshift(s);
    return list;
  }

  function runs(entry) {
    return !entry.skip && typeof entry.fn === 'function';
  }

  function beforeAll(entry) {
    let step = Promise.resolve();
    suitesOf(entry).forEach(function (suite) {
      if (suite.started) return;
      suite.started = true;
      suite.beforeAll.forEach(function (hook) {
        step = step.then(function () { if (!suite.failure) return call(hook); }).then(undefined, function (error) {
          if (!suite.failure) suite.failure = { error };
        });
      });
    });
    return step;
  }

  function afterAll(entry, index, last) {
    let step = Promise.resolve();
    suitesOf(entry).reverse().forEach(function (suite) {
      if (!suite.started || last.get(suite) !== index) return;
      suite.afterAll.forEach(function (hook) {
        step = step.then(function () { return call(hook); }).then(undefined, function (error) {
          consoleError('afterAll: ' + messageOf(error));
        });
      });
    });
    return step;
  }

  function runOne(entry) {
    const started = Date.now();
    if (!runs(entry)) {
      send(entry, 'skipped', started);
      return Promise.resolve();
    }
    const blocked = suitesOf(entry).find(function (suite) { return suite.failure; });
    if (blocked) {
      const error = blocked.failure.error;
      send(entry, error instanceof AssertionError ? 'fail' : 'error', started, error);
      return Promise.resolve();
    }
    running = true;
    let failure;
    let failed = false;
    const note = function (error) { if (!failed) { failed = true; failure = error; } };
    let step = Promise.resolve();
    chain(entry.suite, 'beforeEach').forEach(function (hook) { step = step.then(function () { return call(hook); }); });
    step = step.then(function () { return call(entry.fn); }).then(undefined, note);
    chain(entry.suite, 'afterEach').forEach(function (hook) {
      step = step.then(function () { return call(hook); }).then(undefined, note);
    });
    return step.then(function () {
      running = false;
      const status = !failed ? 'pass' : failure instanceof AssertionError ? 'fail' : 'error';
      send(entry, status, started, failed ? failure : undefined);
    });
  }

  const api = {
    describe,
    it,
    test,
    expect,
    beforeEach: function (fn) { current.beforeEach.push(fn); },
    afterEach: function (fn) { current.afterEach.push(fn); },
    beforeAll: function (fn) { current.beforeAll.push(fn); },
    afterAll: function (fn) { current.afterAll.push(fn); },
  };
  Object.keys(api).forEach(function (name) { globalThis[name] = api[name]; });

  return {
    load: function (path) {
      file = path;
      current = root;
      load(path);
    },
    run: function (limit) {
      planned = Math.min(limit, tests.length);
      const last = new Map();
      for (let i = 0; i < planned; i++) {
        if (runs(tests[i])) suitesOf(tests[i]).forEach(function (suite) { last.set(suite, i); });
      }
      let step = Promise.resolve();
      tests.slice(0, planned).forEach(function (entry, index) {
        step = step.then(function () {
          const before = runs(entry) ? beforeAll(entry) : Promise.resolve();
          return before.then(function () { return runOne(entry); }).then(function () {
            return afterAll(entry, index, last);
          });
        });
      });
      return step;
    },
    unfinished: function (from, firstStatus, firstMessage, restStatus, restMessage) {
      for (let i = from; i < planned; i++) {
        const first = i === from;
        send(tests[i], first ? firstStatus : restStatus, Date.now(), new Error(first ? firstMessage : restMessage));
      }
    },
    count: function () { return tests.length; },
  };
})`;
