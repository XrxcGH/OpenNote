// JavaScript for code cells: the QuickJS interpreter compiled to WebAssembly (quickjs-emscripten, MIT;
// THIRD_PARTY_NOTICES.md), inside the sandbox worker. A cell's code runs in QuickJS, not in the browser's engine, so
// it sees only the language and the console given here: no fetch, timers, modules, or worker globals. QuickJS stops
// the cell at the memory limit, the stack limit, and the time limit.
import { newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime } from 'quickjs-emscripten-core';
import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import type { Output } from './output';
import type { Limits, Stream } from './protocol';
import type { Ran } from './python';

const CONSOLE: readonly (readonly [string, Stream])[] = [
  ['log', 'out'],
  ['info', 'out'],
  ['debug', 'out'],
  ['warn', 'err'],
  ['error', 'err'],
];

/** A value as console.log shows it: strings as they are, everything else as JSON where it can be. */
export function shown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function addConsole(vm: QuickJSContext, output: Output): void {
  const console = vm.newObject();
  for (const [name, stream] of CONSOLE) {
    const fn = vm.newFunction(name, (...args: QuickJSHandle[]) => {
      output.write(stream, `${args.map((arg) => shown(vm.dump(arg))).join(' ')}\n`);
    });
    vm.setProp(console, name, fn);
    if (name === 'log') vm.setProp(vm.global, 'print', fn);
    fn.dispose();
  }
  vm.setProp(vm.global, 'console', console);
  console.dispose();
}

interface Thrown {
  name?: string;
  message?: string;
  stack?: string;
}

const STACK_OVERFLOW = 'InternalError: stack overflow (too much recursion)\n';

function failure(error: unknown, output: Output, deadline: number): Ran {
  const thrown = (typeof error === 'object' && error !== null ? error : { message: String(error) }) as Thrown;
  const message = thrown.message ?? '';
  // Only the real deadline counts: a cell that throws its own {name: 'InternalError', message: 'interrupted'} is an
  // ordinary error.
  if (thrown.name === 'InternalError' && message === 'interrupted' && Date.now() >= deadline) {
    return { status: 'time', message: '' };
  }
  if (thrown.name === 'InternalError' && /out of memory|stack overflow/i.test(message)) {
    output.write('err', `${thrown.name}: ${message}\n`);
    return { status: 'memory', message };
  }
  output.write('err', `${thrown.name ?? 'Error'}: ${message}\n${thrown.stack ?? ''}`);
  return { status: 'error', message };
}

/** Loads the runtime; the returned function runs one cell's text until `deadline` (a Date.now() time). */
export async function prepareJavaScript(
  output: Output,
  limits: Limits,
): Promise<(source: string, deadline: number) => Ran> {
  const quickjs = await newQuickJSWASMModuleFromVariant(newVariant(releaseSync, { wasmLocation: wasmUrl }));
  return (source, deadline) => {
    const runtime = quickjs.newRuntime();
    runtime.setMemoryLimit(limits.memoryBytes);
    runtime.setMaxStackSize(limits.stackBytes);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
    const vm = runtime.newContext();
    try {
      return runIn(vm, runtime, source, output, deadline);
    } catch (error) {
      // Deep recursion can use up the worker's own stack before QuickJS's stack limit trips; the browser then throws
      // a RangeError out of the interpreter. It is reported as an ordinary error in the cell, not as a failure of the runtime.
      if (error instanceof RangeError) {
        output.write('err', STACK_OVERFLOW);
        return { status: 'error', message: 'stack overflow' };
      }
      throw error;
    } finally {
      try {
        vm.dispose();
        runtime.dispose();
      } catch {
        // A runtime stopped at a limit may still hold values; the worker ends right after anyway.
      }
    }
  };
}

function runIn(vm: QuickJSContext, runtime: QuickJSRuntime, source: string, output: Output, deadline: number): Ran {
  addConsole(vm, output);
  const result = vm.evalCode(source, 'cell.js');
  if (result.error) {
    const error = vm.dump(result.error);
    result.error.dispose();
    return failure(error, output, deadline);
  }
  // Promises the cell made settle now, inside the same limits.
  const jobs = runtime.executePendingJobs();
  if (jobs.error) {
    result.value.dispose();
    const error = vm.dump(jobs.error);
    jobs.error.dispose();
    return failure(error, output, deadline);
  }
  // The last value, or what a promise for it settled to.
  const state = vm.getPromiseState(result.value);
  if (state.type === 'rejected') {
    const error = vm.dump(state.error);
    state.error.dispose();
    result.value.dispose();
    return failure(error, output, deadline);
  }
  const value: unknown = state.type === 'fulfilled' ? vm.dump(state.value) : undefined;
  if (state.type === 'fulfilled' && !state.notAPromise) state.value.dispose();
  result.value.dispose();
  if (value !== undefined) output.write('out', `→ ${shown(value)}\n`);
  return { status: 'ok', message: '' };
}
