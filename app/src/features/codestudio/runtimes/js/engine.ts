// One run of a JavaScript or TypeScript program in QuickJS (DESIGN 2.1, 4). Each run gets a fresh QuickJS runtime
// with the page's memory, stack, and time limits. Project files are modules: Sucrase turns `import` into `require`
// (transpile.ts), and the loader below serves `require` from the mounted project (modules.ts). The main file runs
// as a script, so its last value is shown after an arrow, as in code cells. With a test harness that asks for
// framework tests, the test API (harness.ts) runs every *.test and *.spec file and reports one result per test.
//
// Limits. QuickJS's own memory limit cannot see the size of a block in this WebAssembly build. So the heap itself
// is capped (`cappedHeap`). The interrupt handler also ends the run when the heap has grown past the run's limit.
// The handler sets `limit` when it stops the run at the deadline or at the memory limit. An interrupt inside a
// promise job only rejects a promise, so the run checks `limit` after every batch of jobs.

import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core';
import type { Emit, RunContext, RunEnd, RunFile, RunRequest, Stream } from '../../contracts/run';
import type { TestResult, TestStatus } from '../../contracts/testing';
import { PROJECT_LIMITS } from '../../contracts/project';
import { MESSAGE_LIMITS } from '../../run/protocol';
import { t } from '../../../../strings/t';
import { firstProjectFrame, inlinePlace, pathAtEnd } from './diagnostics';
import { ENVIRONMENT } from './environment';
import { TEST_API } from './harness';
import { SCRIPT_FILE, resolveModule } from './modules';
import { compile } from './transpile';
import type { Compiled } from './transpile';
import type { Transform } from './transpile';

export interface Engine {
  quickjs: QuickJSWASMModule;
  transform: Transform;
}

/** Test files: run in place of `main` when a run asks for framework tests. */
export const TEST_FILE = /\.(?:test|spec)\.[mc]?[jt]s$/;

const PAGE_BYTES = 64 * 1024;
/** The heap the QuickJS release build starts with: Emscripten's default INITIAL_MEMORY, 16 MiB. */
export const BASE_HEAP_BYTES = 16 * 1024 * 1024;

/** A WebAssembly heap for QuickJS that cannot grow more than `memoryBytes` past its start. */
export function cappedHeap(memoryBytes: number): WebAssembly.Memory {
  return new WebAssembly.Memory({
    initial: BASE_HEAP_BYTES / PAGE_BYTES,
    maximum: Math.ceil((BASE_HEAP_BYTES + memoryBytes) / PAGE_BYTES),
  });
}

/**
 * Serves `require` inside QuickJS. `compile(path)` gives a module's function; `resolve(specifier, from)` gives the
 * project path or throws. Modules are cached before they run, so an import cycle gets the exports made so far,
 * as in Node. Returns the function that makes a `require` for a file.
 */
const LOADER = String.raw`(function (compile, resolve, root) {
  'use strict';
  const cache = Object.create(null);
  function folder(path) {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? '' : path.slice(0, slash);
  }
  function requireFrom(from) {
    return function require(specifier) {
      const path = resolve(String(specifier), from);
      if (cache[path]) return cache[path].exports;
      const module = { id: path, exports: {} };
      cache[path] = module;
      compile(path).call(module.exports, module.exports, requireFrom(path), module, path, folder(path));
      return module.exports;
    };
  }
  const main = { id: root, exports: {} };
  cache[root] = main;
  globalThis.module = main;
  globalThis.exports = main.exports;
  globalThis.require = requireFrom(root);
  return requireFrom;
})`;

/** The wrapper around a module's text. It starts on the file's first line, so every line keeps its number. */
const WRAPPER = '(function (exports, require, module, __filename, __dirname) {';

const STACK_OVERFLOW = 'InternalError: stack overflow (too much recursion)\n';
const OUT_OF_MEMORY = /^InternalError: out of memory/;

interface Thrown {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  /** The thrown value as console.log shows it, for a value that is not an error. */
  shown?: string;
}

interface Reported {
  name: string;
  file: string;
  status: TestStatus;
  timeMs: number;
  index?: number;
  message?: string;
  expected?: string;
  actual?: string;
  stack?: string;
}

const cut = (text: string) => text.slice(0, MESSAGE_LIMITS.shortChars);

/** A value as text, with no way to throw: JSON for a string, as Node shows a thrown string. */
function safeText(value: unknown): string {
  try {
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'bigint') return `${value}n`;
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Runs one request. Never throws for the program's own errors; those end the run as "error". */
export function runProgram(engine: Engine, request: RunRequest, emit: Emit, context: RunContext): RunEnd {
  const runtime = engine.quickjs.newRuntime();
  runtime.setMemoryLimit(request.limits.memoryBytes);
  runtime.setMaxStackSize(request.limits.stackBytes);
  const run = new Run(engine.transform, runtime, request, emit, context, engine.quickjs.getWasmMemory());
  runtime.setInterruptHandler(() => run.interrupt());
  try {
    return run.start();
  } catch (error) {
    // Deep recursion can use up the worker's own stack before QuickJS's limit trips; the browser then throws a
    // RangeError out of the interpreter. It is the program's error, as in code cells.
    if (error instanceof RangeError) {
      emit({ kind: 'out', stream: 'err', text: STACK_OVERFLOW });
      return { status: 'error', message: 'InternalError', exitCode: 1 };
    }
    throw error;
  } finally {
    try {
      run.dispose();
      runtime.dispose();
    } catch {
      // A runtime stopped at a limit may still hold values; the worker ends right after anyway.
    }
  }
}

class Run {
  readonly vm: QuickJSContext;
  exitCode: number | undefined;
  /** The limit that ended the run, set by the interrupt handler or by an out-of-memory error. */
  limit: 'time' | 'memory' | null = null;
  /** While the host reports the end of a stopped test run, the interrupt handler lets QuickJS go on. */
  private closing = false;
  private readonly heapStart: number;
  private inspect: QuickJSHandle | null = null;
  private requireFrom: QuickJSHandle | null = null;
  private results: TestResult[] = [];
  private ids = new Map<string, number>();
  private testsReported = 0;
  /** Characters put before line 1 of each compiled file, taken off columns on line 1 in a stack. */
  private shifts = new Map<string, number>();

  constructor(
    private transform: Transform,
    private runtime: QuickJSRuntime,
    private request: RunRequest,
    private emit: Emit,
    private context: RunContext,
    private heap: WebAssembly.Memory,
  ) {
    this.heapStart = heap.buffer.byteLength;
    this.vm = runtime.newContext();
  }

  dispose(): void {
    this.inspect?.dispose();
    this.requireFrom?.dispose();
    this.vm.dispose();
  }

  /** The interrupt handler: true stops QuickJS. */
  interrupt(): boolean {
    if (this.closing) return false;
    if (this.exitCode !== undefined || this.limit !== null) return true;
    if (performance.now() > this.context.deadline) this.limit = 'time';
    else if (this.overMemory()) this.limit = 'memory';
    return this.limit !== null;
  }

  private overMemory(): boolean {
    return this.heap.buffer.byteLength - this.heapStart > this.request.limits.memoryBytes;
  }

  private write(stream: Stream, text: string): void {
    if (this.exitCode === undefined && text !== '') this.emit({ kind: 'out', stream, text });
  }

  /** A host function on the VM, disposed after `after`. */
  private withFunction<T>(
    name: string,
    body: (...args: QuickJSHandle[]) => QuickJSHandle | { error: QuickJSHandle } | undefined,
    after: (handle: QuickJSHandle) => T,
  ): T {
    const handle = this.vm.newFunction(name, body);
    try {
      return after(handle);
    } finally {
      handle.dispose();
    }
  }

  /** Evaluates a prelude, a function in text, and calls it with `args`. Its result or the error. */
  private callPrelude(source: string, file: string, args: QuickJSHandle[]): { value: QuickJSHandle } | Thrown {
    const made = this.vm.evalCode(source, file, { type: 'global' });
    if (made.error) return this.dumpError(made.error);
    const called = this.vm.callFunction(made.value, this.vm.undefined, ...args);
    made.value.dispose();
    if (called.error) return this.dumpError(called.error);
    return { value: called.value };
  }

  /** A thrown value as host data. A value that is not an error also gets its console.log text. */
  private dumpError(handle: QuickJSHandle): Thrown {
    const type = this.vm.typeof(handle);
    let dumped: unknown;
    try {
      dumped = this.vm.dump(handle);
    } catch {
      dumped = undefined;
    }
    // dump() gives a string for an object JSON cannot hold, such as a cyclic one.
    const object = type === 'object' && typeof dumped === 'object' && dumped !== null ? (dumped as Thrown) : null;
    const plain = !object || (object.name === undefined && object.stack === undefined);
    const shown = plain && type !== 'string' && this.inspect !== null && this.limit === null ? this.show(handle) : '';
    handle.dispose();
    const thrown: Thrown = object
      ? { name: object.name, message: object.message, stack: object.stack }
      : { message: type === 'object' ? undefined : dumped };
    return shown === '' ? thrown : { ...thrown, shown };
  }

  private setUp(): Thrown | null {
    const vm = this.vm;
    const stdin = this.context.stdin;
    const argv = JSON.stringify(['opennote', this.request.main, ...this.request.args]);
    const write = vm.newFunction('write', (stream, text) => {
      this.write(vm.getString(stream) === 'err' ? 'err' : 'out', vm.getString(text));
    });
    const readLine = vm.newFunction('readLine', () => {
      const line = stdin.line();
      return line === null ? vm.null : vm.newString(line);
    });
    const exit = vm.newFunction('exit', (code) => {
      this.exitCode = vm.getNumber(code);
      throw new Error('exit');
    });
    const random = vm.newFunction('random', () => vm.newNumber(this.context.random()));
    const argvText = vm.newString(argv);
    const handles = [write, readLine, exit, random, argvText];
    const made = this.callPrelude(ENVIRONMENT, '<environment>', handles);
    handles.forEach((handle) => handle.dispose());
    if (!('value' in made)) return made;
    this.inspect = made.value;

    const loaded = this.withFunction(
      'compile',
      (path) => this.compileModule(vm.getString(path)),
      (compileFn) =>
        this.withFunction(
          'resolve',
          (specifier, from) => vm.newString(this.resolve(vm.getString(specifier), vm.getString(from))),
          (resolveFn) => {
            // In a test run no file is the main script, so a test file that is also `main` still loads as a module.
            const root = vm.newString(this.request.test?.framework ? '' : this.request.main);
            try {
              return this.callPrelude(LOADER, '<loader>', [compileFn, resolveFn, root]);
            } finally {
              root.dispose();
            }
          },
        ),
    );
    if (!('value' in loaded)) return loaded;
    this.requireFrom = loaded.value;
    return null;
  }

  private resolve(specifier: string, from: string): string {
    const found = resolveModule(specifier, from, (path) => this.context.files.read(path) !== null);
    if ('path' in found) return found.path;
    const where = from === '' ? this.request.main : from;
    throw new Error(
      found.missing === 'package'
        ? t('codeStudio.js.modules.missingPackage', { specifier, from: where })
        : t('codeStudio.js.modules.missingFile', { specifier, from: where }),
    );
  }

  /** Why a file cannot be compiled, in the words a person reads. */
  private compileMessage(compiled: Exclude<Compiled, { code: string }>): string {
    if (compiled.unsupported === 'namespace') return t('codeStudio.js.typescript.namespace');
    if (compiled.unsupported === 'declarators') return t('codeStudio.js.typescript.declarators');
    return compiled.message;
  }

  /** A module's function, from its file. Sucrase's syntax errors carry their place in the message. */
  private compileModule(path: string): QuickJSHandle | { error: QuickJSHandle } {
    const text = this.context.files.read(path) ?? '';
    let code: string;
    let shift = 0;
    if (path.endsWith('.json')) {
      code = `module.exports = JSON.parse(${JSON.stringify(text)});`;
    } else if (SCRIPT_FILE.test(path)) {
      const compiled = compile(path, text, this.transform);
      if (!('code' in compiled)) {
        const message = this.compileMessage(compiled);
        throw new SyntaxError(`${message} (${path}:${compiled.line}:${compiled.column})`);
      }
      code = compiled.code;
      shift = compiled.shift;
    } else {
      throw new Error(t('codeStudio.js.modules.notScript', { path }));
    }
    this.shifts.set(path, WRAPPER.length + shift);
    const made = this.vm.evalCode(`${WRAPPER}${code}\n})`, path, { type: 'global' });
    return made.error ? { error: made.error } : made.value;
  }

  /** `stack` with the columns on line 1 of compiled files moved back to the file's own columns. */
  private fileColumns(stack: string): string {
    if (this.shifts.size === 0) return stack;
    const paths = [...this.shifts.keys()].map((path) => ({ path, text: '' }));
    return stack.replace(/^(\s+at .*):1:(\d+)(\)?\s*)$/gm, (whole, before: string, column: string, end: string) => {
      const file = pathAtEnd(before, paths, ' (');
      const shift = file ? (this.shifts.get(file.path) ?? 0) : 0;
      return shift === 0 ? whole : `${before}:1:${Math.max(1, Number(column) - shift)}${end}`;
    });
  }

  start(): RunEnd {
    const failed = this.setUp();
    if (failed) return this.failure(failed);
    if (this.request.test?.framework) return this.runTests();
    return this.runMain();
  }

  private syntaxError(path: string, compiled: Exclude<Compiled, { code: string }>): RunEnd {
    const message = this.compileMessage(compiled);
    this.write('err', `SyntaxError: ${message}\n    at ${path}:${compiled.line}:${compiled.column}\n`);
    return { status: 'error', message: 'SyntaxError', exitCode: 1 };
  }

  private runMain(): RunEnd {
    const { main } = this.request;
    const text = this.context.files.read(main);
    if (!SCRIPT_FILE.test(main) || text === null) {
      const message =
        text === null
          ? t('codeStudio.js.modules.missingMain', { path: main })
          : t('codeStudio.js.modules.notScript', { path: main });
      this.write('err', `Error: ${message}\n`);
      return { status: 'error', message: 'Error', exitCode: 1 };
    }
    const compiled = compile(main, text, this.transform);
    if (!('code' in compiled)) return this.syntaxError(main, compiled);
    if (compiled.shift > 0) this.shifts.set(main, compiled.shift);
    const result = this.vm.evalCode(compiled.code, main, { type: 'global' });
    if (result.error) return this.failure(this.dumpError(result.error));
    // Promises the program made settle now, inside the same limits.
    const jobs = this.runtime.executePendingJobs();
    if (this.limit === null && this.overMemory()) this.limit = 'memory';
    if (this.limit !== null || this.exitCode !== undefined) {
      if (jobs.error) jobs.error.dispose();
      result.value.dispose();
      return this.limit !== null ? this.limitEnd() : this.exited();
    }
    if (jobs.error) {
      result.value.dispose();
      return this.failure(this.dumpError(jobs.error));
    }
    const state = this.vm.getPromiseState(result.value);
    if (state.type === 'rejected') {
      result.value.dispose();
      return this.failure(this.dumpError(state.error));
    }
    let shown: string | null = null;
    if (state.type === 'fulfilled') {
      const value = state.value;
      if (this.vm.typeof(value) !== 'undefined') shown = this.show(value);
      if (!state.notAPromise) value.dispose();
    }
    result.value.dispose();
    if (this.exitCode !== undefined) return this.exited();
    if (this.limit !== null) return this.limitEnd();
    if (shown !== null) this.write('out', `→ ${shown}\n`);
    return { status: 'ok', message: '', exitCode: 0 };
  }

  /** A value as console.log shows it; empty when that fails. */
  private show(value: QuickJSHandle): string {
    const shown = this.vm.callFunction(this.inspect!, this.vm.undefined, value);
    if (shown.error) {
      shown.error.dispose();
      return '';
    }
    const text = this.vm.getString(shown.value);
    shown.value.dispose();
    return text;
  }

  private exited(): RunEnd {
    const code = this.exitCode ?? 0;
    return { status: code === 0 ? 'ok' : 'error', message: '', exitCode: code };
  }

  private limitEnd(): RunEnd {
    if (this.limit === 'memory') {
      this.write('err', 'InternalError: out of memory\n');
      return { status: 'memory', message: '' };
    }
    return { status: 'time', message: '' };
  }

  private failure(thrown: Thrown): RunEnd {
    if (this.exitCode !== undefined) return this.exited();
    if (this.limit !== null) return this.limitEnd();
    try {
      return this.describe(thrown);
    } catch {
      // Formatting the error must never end the run as a runtime failure.
      this.write('err', 'Uncaught exception\n');
      return { status: 'error', message: 'Error', exitCode: 1 };
    }
  }

  private describe(thrown: Thrown): RunEnd {
    const name = typeof thrown.name === 'string' ? thrown.name : '';
    const message =
      typeof thrown.message === 'string'
        ? thrown.message
        : thrown.message === undefined
          ? ''
          : safeText(thrown.message);
    if (name === 'InternalError' && OUT_OF_MEMORY.test(`${name}: ${message}`)) {
      this.limit = 'memory';
      return this.limitEnd();
    }
    if (name === '' && thrown.stack === undefined) {
      this.write('err', `Uncaught ${thrown.shown ?? safeText(thrown.message)}\n`);
      return { status: 'error', message: 'Error', exitCode: 1 };
    }
    const stack = typeof thrown.stack === 'string' ? this.fileColumns(thrown.stack) : '';
    this.write('err', `${name || 'Error'}: ${message}\n${stack}`);
    return { status: 'error', message: name || 'Error', exitCode: 1 };
  }

  // Tests ------------------------------------------------------------------------------------------------------------

  private testFiles(): RunFile[] {
    const tests = this.request.files.filter((file) => TEST_FILE.test(file.path));
    if (tests.length > 0) return tests;
    return this.request.files.filter((file) => file.path === this.request.main && SCRIPT_FILE.test(file.path));
  }

  /** One result from the test API. Dropped after an exit or a limit: those end the run, not the test. */
  private received(json: string): void {
    if (this.exitCode !== undefined || (this.limit !== null && !this.closing)) return;
    if (!this.closing && performance.now() > this.context.deadline) {
      this.limit = 'time';
      return;
    }
    let found: Reported;
    try {
      found = JSON.parse(json) as Reported;
    } catch {
      return;
    }
    if (!this.closing && found.status === 'error' && OUT_OF_MEMORY.test(found.message ?? '')) {
      this.limit = 'memory';
      return;
    }
    if (typeof found.index === 'number') this.testsReported = Math.max(this.testsReported, found.index + 1);
    this.report(found);
  }

  private report(found: Reported): void {
    // `ids` keeps every id given and, for a repeated one, the last number added to it, so equal names stay cheap.
    const base = `${found.file}::${found.name}`;
    let id = base;
    let n = this.ids.get(base);
    if (n !== undefined) {
      do id = `${base} (${++n})`;
      while (this.ids.has(id));
      this.ids.set(base, n);
    }
    if (!this.ids.has(id)) this.ids.set(id, 1);
    const location =
      found.status === 'fail' || found.status === 'error' || found.status === 'time'
        ? (inlinePlace(found.message ?? '', this.request.files) ??
          firstProjectFrame(found.stack ?? '', this.request.files))
        : null;
    const result: TestResult = {
      id: cut(id),
      name: cut(found.name),
      status: found.status,
      timeMs: Math.max(0, found.timeMs),
      ...(found.message === undefined ? {} : { message: cut(found.message) }),
      ...(found.expected === undefined ? {} : { expected: cut(found.expected) }),
      ...(found.actual === undefined ? {} : { actual: cut(found.actual) }),
      ...(location ? { location: { file: location.file, line: location.line } } : {}),
    };
    this.results.push(result);
    this.emit({ kind: 'test', result });
    const line =
      result.status === 'pass'
        ? t('codeStudio.js.tests.pass', { name: result.name })
        : result.status === 'skipped'
          ? t('codeStudio.js.tests.skip', { name: result.name })
          : t('codeStudio.js.tests.fail', { name: result.name });
    const detail = result.message ? `\n${result.message.replace(/^/gm, '    ')}` : '';
    this.write('out', `${line}${detail}\n`);
  }

  private runTests(): RunEnd {
    const vm = this.vm;
    const unsupported = ['test.only', 'it.only', 'describe.only', 'test.each', 'it.each', 'describe.each'];
    const text = vm.newString(
      JSON.stringify({
        nested: t('codeStudio.js.tests.nested'),
        notSupported: Object.fromEntries(
          unsupported.map((name) => [name, t('codeStudio.js.tests.notSupported', { name })]),
        ),
      }),
    );
    const api = this.withFunction(
      'report',
      (json) => void this.received(vm.getString(json)),
      (reportFn) =>
        this.withFunction(
          'load',
          (path) => {
            const from = vm.newString('');
            const required = vm.callFunction(this.requireFrom!, vm.undefined, from);
            from.dispose();
            if (required.error) return { error: required.error };
            const specifier = vm.newString(`./${vm.getString(path)}`);
            const loaded = vm.callFunction(required.value, vm.undefined, specifier);
            specifier.dispose();
            required.value.dispose();
            if (loaded.error) return { error: loaded.error };
            loaded.value.dispose();
            return undefined;
          },
          (loadFn) => this.callPrelude(TEST_API, '<test-api>', [reportFn, loadFn, text]),
        ),
    );
    text.dispose();
    if (!('value' in api)) return this.failure(api);
    try {
      return this.runTestsWith(api.value);
    } finally {
      api.value.dispose();
    }
  }

  private callMethod(
    object: QuickJSHandle,
    name: string,
    args: (QuickJSHandle | string | number)[] = [],
  ): { value: QuickJSHandle } | Thrown {
    const handles = args.map((arg) =>
      typeof arg === 'string' ? this.vm.newString(arg) : typeof arg === 'number' ? this.vm.newNumber(arg) : arg,
    );
    const method = this.vm.getProp(object, name);
    const called = this.vm.callFunction(method, object, ...handles);
    method.dispose();
    handles.forEach((handle, index) => {
      if (handle !== args[index]) handle.dispose();
    });
    if (called.error) return this.dumpError(called.error);
    return { value: called.value };
  }

  /** Sends a result for each test from the first one not reported: `first` for it, `rest` for the others. */
  private unfinished(api: QuickJSHandle, first: [TestStatus, string], rest: [TestStatus, string]): void {
    this.closing = true;
    const done = this.callMethod(api, 'unfinished', [this.testsReported, ...first, ...rest]);
    if ('value' in done) done.value.dispose();
  }

  private runTestsWith(api: QuickJSHandle): RunEnd {
    const vm = this.vm;
    for (const file of this.testFiles()) {
      const loaded = this.callMethod(api, 'load', [file.path]);
      if ('value' in loaded) {
        loaded.value.dispose();
        continue;
      }
      if (this.stoppedBy(loaded)) return this.failure(loaded);
      const name = typeof loaded.name === 'string' ? loaded.name : 'Error';
      const message = typeof loaded.message === 'string' ? loaded.message : safeText(loaded.message);
      this.failure(loaded);
      this.report({
        name: file.path,
        file: file.path,
        status: 'error',
        timeMs: 0,
        message: `${t('codeStudio.js.tests.loadFailed')}\n${name}: ${message}`,
        ...(typeof loaded.stack === 'string' ? { stack: loaded.stack } : {}),
      });
    }
    const counted = this.callMethod(api, 'count');
    if (!('value' in counted)) return this.failure(counted);
    const total = vm.getNumber(counted.value);
    counted.value.dispose();
    if (total === 0 && this.results.length === 0) this.write('out', `${t('codeStudio.js.tests.none')}\n`);
    const planned = Math.min(total, PROJECT_LIMITS.tests);
    if (total > planned) this.write('err', `${t('codeStudio.js.tests.tooMany', { count: total, max: planned })}\n`);

    const ran = this.callMethod(api, 'run', [planned]);
    if (!('value' in ran)) return this.failure(ran);
    const jobs = this.runtime.executePendingJobs();
    const state = vm.getPromiseState(ran.value);
    ran.value.dispose();
    if (state.type === 'fulfilled' && !state.notAPromise) state.value.dispose();
    const rejected = state.type === 'rejected' ? this.dumpError(state.error) : null;
    const jobError = jobs.error ? this.dumpError(jobs.error) : null;
    if (this.exitCode !== undefined) return this.exited();
    if (this.limit === null && this.overMemory()) this.limit = 'memory';
    if (this.limit !== null) {
      const first: [TestStatus, string] =
        this.limit === 'time' ? ['time', t('codeStudio.js.tests.time')] : ['error', t('codeStudio.js.tests.memory')];
      this.unfinished(api, first, ['skipped', t('codeStudio.js.tests.notRunLimit')]);
      this.summary();
      return this.limitEnd();
    }
    if (jobError) return this.failure(jobError);
    if (rejected) return this.failure(rejected);
    if (state.type === 'pending') {
      const stuck = t('codeStudio.js.tests.stuck');
      this.unfinished(api, ['error', stuck], ['error', t('codeStudio.js.tests.notRun')]);
    }
    const failed = this.summary();
    return failed > 0 || total > planned
      ? { status: 'error', message: '', exitCode: 1 }
      : { status: 'ok', message: '', exitCode: 0 };
  }

  /** Writes the summary line; the number of tests that did not pass. */
  private summary(): number {
    const count = (status: TestStatus) => this.results.filter((result) => result.status === status).length;
    const failed = count('fail') + count('error') + count('time');
    const summary = t('codeStudio.js.tests.summary', {
      passed: count('pass'),
      failed,
      skipped: count('skipped'),
      total: this.results.length,
    });
    this.write('out', `${summary}\n`);
    return failed;
  }

  /** Whether an error is a limit or an exit, which ends the whole run rather than one test. */
  private stoppedBy(thrown: Thrown): boolean {
    if (this.exitCode !== undefined || this.limit !== null) return true;
    return thrown.name === 'InternalError' && OUT_OF_MEMORY.test(`InternalError: ${String(thrown.message)}`);
  }
}
