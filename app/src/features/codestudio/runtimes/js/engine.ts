// One run of a JavaScript or TypeScript program in QuickJS (DESIGN 2.1, 4). Each run gets a fresh QuickJS runtime
// with the page's memory, stack, and time limits. Project files are modules: Sucrase turns `import` into `require`
// (transpile.ts), and the loader below serves `require` from the mounted project (modules.ts). The main file runs
// as a script, so its last value is shown after an arrow, as in code cells. With a test harness that asks for
// framework tests, the test API (harness.ts) runs every *.test and *.spec file and reports one result per test.

import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core';
import type { Emit, RunContext, RunEnd, RunFile, RunRequest, Stream } from '../../contracts/run';
import type { TestResult, TestStatus } from '../../contracts/testing';
import { MESSAGE_LIMITS } from '../../run/protocol';
import { t } from '../../../../strings/t';
import { firstProjectFrame, inlinePlace } from './diagnostics';
import { ENVIRONMENT } from './environment';
import { TEST_API } from './harness';
import { SCRIPT_FILE, resolveModule } from './modules';
import { compile } from './transpile';
import type { Compiled, Transform } from './transpile';

export interface Engine {
  quickjs: QuickJSWASMModule;
  transform: Transform;
}

/** Test files: run in place of `main` when a run asks for framework tests. */
export const TEST_FILE = /\.(?:test|spec)\.[mc]?[jt]s$/;

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

const STACK_OVERFLOW = 'InternalError: stack overflow (too much recursion)\n';

interface Thrown {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
}

interface Reported {
  name: string;
  file: string;
  status: TestStatus;
  timeMs: number;
  message?: string;
  expected?: string;
  actual?: string;
  stack?: string;
}

const cut = (text: string) => text.slice(0, MESSAGE_LIMITS.shortChars);

/** Runs one request. Never throws for the program's own errors; those end the run as "error". */
export function runProgram(engine: Engine, request: RunRequest, emit: Emit, context: RunContext): RunEnd {
  const runtime = engine.quickjs.newRuntime();
  runtime.setMemoryLimit(request.limits.memoryBytes);
  runtime.setMaxStackSize(request.limits.stackBytes);
  const run = new Run(engine.transform, runtime, request, emit, context);
  runtime.setInterruptHandler(() => run.exitCode !== undefined || performance.now() > context.deadline);
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
  private inspect: QuickJSHandle | null = null;
  private requireFrom: QuickJSHandle | null = null;
  private results: TestResult[] = [];
  private ids = new Set<string>();

  constructor(
    private transform: Transform,
    private runtime: QuickJSRuntime,
    private request: RunRequest,
    private emit: Emit,
    private context: RunContext,
  ) {
    this.vm = runtime.newContext();
  }

  dispose(): void {
    this.inspect?.dispose();
    this.requireFrom?.dispose();
    this.vm.dispose();
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

  private dumpError(handle: QuickJSHandle): Thrown {
    const dumped: unknown = this.vm.dump(handle);
    handle.dispose();
    return typeof dumped === 'object' && dumped !== null ? (dumped as Thrown) : { message: dumped };
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

  /** A module's function, from its file. Sucrase's syntax errors carry their place in the message. */
  private compileModule(path: string): QuickJSHandle | { error: QuickJSHandle } {
    const text = this.context.files.read(path) ?? '';
    let code: string;
    if (path.endsWith('.json')) {
      code = `module.exports = JSON.parse(${JSON.stringify(text)});`;
    } else if (SCRIPT_FILE.test(path)) {
      const compiled = compile(path, text, this.transform);
      if (!('code' in compiled))
        throw new SyntaxError(`${compiled.message} (${path}:${compiled.line}:${compiled.column})`);
      code = compiled.code;
    } else {
      throw new Error(t('codeStudio.js.modules.notScript', { path }));
    }
    // The wrapper starts on the file's first line, so every line keeps its number.
    const made = this.vm.evalCode(`(function (exports, require, module, __filename, __dirname) {${code}\n})`, path, {
      type: 'global',
    });
    return made.error ? { error: made.error } : made.value;
  }

  start(): RunEnd {
    const failed = this.setUp();
    if (failed) return this.failure(failed);
    if (this.request.test?.framework) return this.runTests();
    return this.runMain();
  }

  private syntaxError(path: string, compiled: Exclude<Compiled, { code: string }>): RunEnd {
    this.write('err', `SyntaxError: ${compiled.message}\n    at ${path}:${compiled.line}:${compiled.column}\n`);
    return { status: 'error', message: 'SyntaxError', exitCode: 1 };
  }

  private runMain(): RunEnd {
    const { main } = this.request;
    if (!SCRIPT_FILE.test(main)) {
      this.write('err', `Error: ${t('codeStudio.js.modules.notScript', { path: main })}\n`);
      return { status: 'error', message: 'Error', exitCode: 1 };
    }
    const compiled = compile(main, this.context.files.read(main) ?? '', this.transform);
    if (!('code' in compiled)) return this.syntaxError(main, compiled);
    const result = this.vm.evalCode(compiled.code, main, { type: 'global' });
    if (result.error) return this.failure(this.dumpError(result.error));
    // Promises the program made settle now, inside the same limits.
    const jobs = this.runtime.executePendingJobs();
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
    if (shown !== null) this.write('out', `→ ${shown}\n`);
    return { status: 'ok', message: '', exitCode: 0 };
  }

  /** A value as console.log shows it. */
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

  private failure(thrown: Thrown): RunEnd {
    if (this.exitCode !== undefined) return this.exited();
    const name = typeof thrown.name === 'string' ? thrown.name : '';
    const message = typeof thrown.message === 'string' ? thrown.message : String(thrown.message ?? '');
    // Only the real deadline counts: a program that throws its own {name: 'InternalError', message: 'interrupted'}
    // has an ordinary error.
    if (name === 'InternalError' && message === 'interrupted' && performance.now() > this.context.deadline) {
      return { status: 'time', message: '' };
    }
    if (name === 'InternalError' && /out of memory/i.test(message)) {
      this.write('err', `${name}: ${message}\n`);
      return { status: 'memory', message: '' };
    }
    const stack = typeof thrown.stack === 'string' ? thrown.stack : '';
    if (name === '' && thrown.stack === undefined) {
      this.write('err', `Uncaught ${JSON.stringify(thrown.message) ?? 'undefined'}\n`);
      return { status: 'error', message: 'Error', exitCode: 1 };
    }
    this.write('err', `${name || 'Error'}: ${message}\n${stack}`);
    return { status: 'error', message: name || 'Error', exitCode: 1 };
  }

  // Tests ------------------------------------------------------------------------------------------------------------

  private testFiles(): RunFile[] {
    const tests = this.request.files.filter((file) => TEST_FILE.test(file.path));
    if (tests.length > 0) return tests;
    return this.request.files.filter((file) => file.path === this.request.main && SCRIPT_FILE.test(file.path));
  }

  private report(found: Reported): void {
    let id = `${found.file}::${found.name}`;
    for (let n = 2; this.ids.has(id); n++) id = `${found.file}::${found.name} (${n})`;
    this.ids.add(id);
    const location =
      found.status === 'fail' || found.status === 'error'
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
    const api = this.withFunction(
      'report',
      (json) => void this.report(JSON.parse(vm.getString(json)) as Reported),
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
          (loadFn) => this.callPrelude(TEST_API, '<test-api>', [reportFn, loadFn]),
        ),
    );
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
    args: QuickJSHandle[] = [],
  ): { value: QuickJSHandle } | Thrown {
    const method = this.vm.getProp(object, name);
    const called = this.vm.callFunction(method, object, ...args);
    method.dispose();
    if (called.error) return this.dumpError(called.error);
    return { value: called.value };
  }

  private runTestsWith(api: QuickJSHandle): RunEnd {
    const vm = this.vm;
    for (const file of this.testFiles()) {
      const path = vm.newString(file.path);
      const loaded = this.callMethod(api, 'load', [path]);
      path.dispose();
      if ('value' in loaded) {
        loaded.value.dispose();
        continue;
      }
      if (this.stoppedBy(loaded)) return this.failure(loaded);
      const name = typeof loaded.name === 'string' ? loaded.name : 'Error';
      const message = typeof loaded.message === 'string' ? loaded.message : String(loaded.message);
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

    const ran = this.callMethod(api, 'run');
    if (!('value' in ran)) return this.failure(ran);
    const jobs = this.runtime.executePendingJobs();
    const state = vm.getPromiseState(ran.value);
    ran.value.dispose();
    if (state.type === 'fulfilled' && !state.notAPromise) state.value.dispose();
    if (state.type === 'rejected') state.error.dispose();
    if (jobs.error) {
      const thrown = this.dumpError(jobs.error);
      if (this.stoppedBy(thrown)) return this.failure(thrown);
    }
    if (state.type === 'pending') {
      const stuck = vm.newString(t('codeStudio.js.tests.stuck'));
      const notRun = vm.newString(t('codeStudio.js.tests.notRun'));
      const done = this.callMethod(api, 'unfinished', [stuck, notRun]);
      stuck.dispose();
      notRun.dispose();
      if ('value' in done) done.value.dispose();
    }
    if (this.exitCode !== undefined) return this.exited();
    const count = (status: TestStatus) => this.results.filter((result) => result.status === status).length;
    const failed = count('fail') + count('error');
    const summary = t('codeStudio.js.tests.summary', {
      passed: count('pass'),
      failed,
      skipped: count('skipped'),
      total: this.results.length,
    });
    this.write('out', `${summary}\n`);
    return failed > 0 ? { status: 'error', message: '', exitCode: 1 } : { status: 'ok', message: '', exitCode: 0 };
  }

  /** Whether an error is a limit or an exit, which ends the whole run rather than one test. */
  private stoppedBy(thrown: Thrown): boolean {
    if (this.exitCode !== undefined) return true;
    if (thrown.name !== 'InternalError') return false;
    return (
      (thrown.message === 'interrupted' && performance.now() > this.context.deadline) ||
      /out of memory/i.test(String(thrown.message))
    );
  }
}
