// A test runtime for run.test.tsx only: QuickJS (already bundled for code cells) behind the RuntimeAdapter contract,
// with just enough host functions to prove the run core: print, input, exit, files, rich images, seeded random,
// and arguments. The real JavaScript runtime belongs to code:L06 (runtimes/js).
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from 'quickjs-emscripten-core';
import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import type { Emit, RunContext, RunEnd, RunRequest, RuntimeAdapter } from '../../contracts/run';
import { ALLOWANCES } from '../adapters';
import { patternMapper } from '../diagnostics';

let quickjs: QuickJSWASMModule | null = null;

interface Thrown {
  name?: string;
  message?: string;
  stack?: string;
}

/** A base64 string that decodes to `bytes` zero bytes. */
const zeros = (bytes: number) =>
  'A'.repeat(Math.floor(bytes / 3) * 4) + (bytes % 3 === 1 ? 'AA==' : bytes % 3 === 2 ? 'AAA=' : '');

function addHost(
  vm: QuickJSContext,
  request: RunRequest,
  emit: Emit,
  context: RunContext,
  exit: (code: number) => void,
): void {
  const fn = (name: string, body: (...args: QuickJSHandle[]) => QuickJSHandle | undefined) => {
    const handle = vm.newFunction(name, body);
    vm.setProp(vm.global, name, handle);
    handle.dispose();
  };
  const text = (args: QuickJSHandle[]) => args.map((arg) => String(vm.dump(arg))).join(' ');
  const str = (handle: QuickJSHandle | undefined) => String(handle ? vm.dump(handle) : '');
  fn('print', (...args) => void emit({ kind: 'out', stream: 'out', text: `${text(args)}\n` }));
  fn('printErr', (...args) => void emit({ kind: 'out', stream: 'err', text: `${text(args)}\n` }));
  fn('input', () => {
    const line = context.stdin.line();
    return line === null ? vm.null : vm.newString(line);
  });
  fn('exit', (code) => {
    exit(Number(str(code)));
    throw new Error('exit');
  });
  fn('readFile', (path) => {
    const found = context.files.read(str(path));
    return found === null ? vm.null : vm.newString(found);
  });
  fn('writeFile', (path, body) => (context.files.write(str(path), str(body)) ? vm.true : vm.false));
  fn('richImage', (bytes) => void emit({ kind: 'rich', mime: 'image/png', data: zeros(Number(str(bytes))) }));
  fn('random', () => vm.newNumber(context.random()));
  const args = vm.newArray();
  request.args.forEach((arg, index) => {
    const value = vm.newString(arg);
    vm.setProp(args, index, value);
    value.dispose();
  });
  vm.setProp(vm.global, 'args', args);
  args.dispose();
}

export const quickjsFixture: RuntimeAdapter = {
  id: 'javascript',
  version: 'QuickJS test fixture',
  allowances: ALLOWANCES.javascript,
  diagnostics: patternMapper([
    { pattern: /\((?<file>[^():\s]+):(?<line>\d+)(?::(?<column>\d+))?\)/, fallbackKind: 'error' },
  ]),
  async load(onProgress) {
    onProgress(10);
    quickjs = await newQuickJSWASMModuleFromVariant(newVariant(releaseSync, { wasmLocation: wasmUrl }));
  },
  run(request, emit, context): Promise<RunEnd> {
    const runtime = quickjs!.newRuntime();
    runtime.setMemoryLimit(request.limits.memoryBytes);
    runtime.setMaxStackSize(request.limits.stackBytes);
    runtime.setInterruptHandler(() => performance.now() > context.deadline);
    const vm = runtime.newContext();
    let exitCode: number | undefined;
    addHost(vm, request, emit, context, (code) => (exitCode = code));
    const source = request.files.find((file) => file.path === request.main)!.text;
    const result = vm.evalCode(source, request.main);
    if (!result.error) {
      result.value.dispose();
      return Promise.resolve({ status: 'ok', message: '', exitCode: 0 });
    }
    const thrown = vm.dump(result.error) as Thrown;
    result.error.dispose();
    if (exitCode !== undefined)
      return Promise.resolve({ status: exitCode === 0 ? 'ok' : 'error', message: '', exitCode });
    if (thrown.name === 'InternalError' && /out of memory/i.test(thrown.message ?? '')) {
      return Promise.resolve({ status: 'memory', message: '' });
    }
    if (thrown.name === 'InternalError' && thrown.message === 'interrupted') {
      return Promise.resolve({ status: 'time', message: '' });
    }
    emit({ kind: 'out', stream: 'err', text: `${thrown.name}: ${thrown.message}\n${thrown.stack ?? ''}` });
    return Promise.resolve({ status: 'error', message: thrown.name ?? '', exitCode: 1 });
  },
};
