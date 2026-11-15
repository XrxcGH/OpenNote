// Runs a compiled C or C++ program (DESIGN 4.3 to 4.5) with @bjorn3/browser_wasi_shim.
//
// Imports: the program is a separate WebAssembly instance with WASI preview 1 and nothing else. A module that asks
// for any other import is refused before it is instantiated.
//
// Files: the one preopened folder is the project mount, the program's "/". A path outside it ("/etc", "../x") is not
// found. Files the program writes go to the overlay.
//
// Input: prefilled text, then end of file. With JSPI in interactive mode, the page gives a line when the text runs
// out. random_get reads the run's seeded source, so the same seed gives the same run.

import {
  ConsoleStdout,
  Directory,
  Fd,
  File,
  type Inode,
  OpenFile,
  PreopenDirectory,
  WASI,
  WASIProcExit,
  wasi as defs,
} from '@bjorn3/browser_wasi_shim';
import { PROJECT_LIMITS } from '../../contracts/project';
import type { Emit, RunContext, RunEnd } from '../../contracts/run';
import { codeStudioCpp } from '../../../../strings/en/codeStudio/cpp';
import { phase, say } from './say';

const WASI_MODULE = 'wasi_snapshot_preview1';
const encoder = new TextEncoder();
/** libc++abi's last words when new fails in a build without exceptions, before it aborts. */
const BAD_ALLOC = /bad_alloc was thrown in -fno-exceptions mode\s*$/;

/** Standard input as a character device that reads the run's input. */
export class Input extends Fd {
  private queue = new Uint8Array(0);
  private ended = false;
  /**
   * Set when fd_read is a JSPI Suspending import that asks the page for a line before the read. Then a read of an
   * empty queue gives 0 bytes and leaves the input open. A read with several buffers (musl's fread uses two) may
   * fill the first one exactly, and the second one must not end the input.
   */
  suspends = false;

  constructor(private readonly context: RunContext) {
    super();
  }

  /** Whether a read now would find nothing queued and the input not yet at its end. */
  get empty(): boolean {
    return this.queue.length === 0 && !this.ended;
  }

  push(text: string | null): void {
    if (text === null) {
      this.ended = true;
      return;
    }
    const bytes = encoder.encode(text);
    const joined = new Uint8Array(this.queue.length + bytes.length);
    joined.set(this.queue);
    joined.set(bytes, this.queue.length);
    this.queue = joined;
  }

  override fd_read(size: number): { ret: number; data: Uint8Array } {
    if (this.empty && !this.suspends) this.push(this.context.stdin.read());
    const data = this.queue.slice(0, size);
    this.queue = this.queue.slice(data.length);
    return { ret: defs.ERRNO_SUCCESS, data };
  }

  override fd_fdstat_get(): { ret: number; fdstat: InstanceType<typeof defs.Fdstat> } {
    const fdstat = new defs.Fdstat(defs.FILETYPE_CHARACTER_DEVICE, 0);
    fdstat.fs_rights_base = BigInt(defs.RIGHTS_FD_READ);
    return { ret: defs.ERRNO_SUCCESS, fdstat };
  }

  override fd_filestat_get(): { ret: number; filestat: InstanceType<typeof defs.Filestat> } {
    return { ret: defs.ERRNO_SUCCESS, filestat: new defs.Filestat(0n, defs.FILETYPE_CHARACTER_DEVICE, 0n) };
  }
}

/** The project mount as the shim's folders, each file with its text as bytes. */
function mountTree(context: RunContext): { root: Map<string, Inode>; texts: Map<string, string> } {
  const root = new Map<string, Inode>();
  const texts = new Map<string, string>();
  for (const path of context.files.paths()) {
    const text = context.files.read(path);
    if (text === null) continue;
    texts.set(path, text);
    const parts = path.split('/');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const next = folder.get(part);
      if (next instanceof Directory) folder = next.contents;
      else if (next === undefined) {
        const made = new Directory(new Map());
        folder.set(part, made);
        folder = made.contents;
      } else break;
    }
    folder.set(parts[parts.length - 1]!, new File(encoder.encode(text)));
  }
  return { root, texts };
}

/** Every file under `folder`, with its project path. */
function* filesIn(folder: Map<string, Inode>, prefix = ''): Generator<[string, File]> {
  for (const [name, node] of folder) {
    if (node instanceof File) yield [prefix + name, node];
    else if (node instanceof Directory) yield* filesIn(node.contents, `${prefix}${name}/`);
  }
}

function bytesIn(folder: Map<string, Inode>): number {
  let total = 0;
  for (const [, file] of filesIn(folder)) total += file.data.byteLength;
  return total;
}

/** The bytes the iovec list at `pointer` asks to write. */
function iovecBytes(memory: WebAssembly.Memory, pointer: number, count: number): bigint {
  const view = new DataView(memory.buffer);
  let total = 0n;
  for (let i = 0; i < count; i++) total += BigInt(view.getUint32(pointer + 8 * i + 4, true));
  return total;
}

/**
 * Holds the files the program writes inside the run's memory limit. A call that would make an open file `end` bytes
 * long is refused when all files together would pass the limit. The size is checked before the shim grows the file,
 * because the shim allocates the whole new size at once (a write past a far seek, pwrite, fallocate, ftruncate).
 */
function budgetFiles(shim: WASI, root: Map<string, Inode>, limit: number, imports: Imports): void {
  const memory = () => shim.inst.exports.memory as WebAssembly.Memory;
  const tooBig = (fd: number, end: bigint): boolean => {
    const open = shim.fds[fd];
    if (!(open instanceof OpenFile)) return false;
    const size = BigInt(open.file.data.byteLength);
    return end > size && BigInt(bytesIn(root)) - size + end > BigInt(limit);
  };
  const guard = (name: string, end: (fd: number, ...rest: (number | bigint)[]) => bigint) => {
    const call = imports[name] as (...args: (number | bigint)[]) => number;
    imports[name] = ((fd: number, ...rest: (number | bigint)[]) =>
      tooBig(fd, end(fd, ...rest)) ? defs.ERRNO_NOSPC : call(fd, ...rest)) as Imports[string];
  };
  const position = (fd: number) => {
    const open = shim.fds[fd];
    return open instanceof OpenFile ? open.file_pos : 0n;
  };
  guard('fd_write', (fd, iovs, count) => position(fd) + iovecBytes(memory(), Number(iovs), Number(count)));
  guard('fd_pwrite', (_, iovs, count, offset) => BigInt(offset) + iovecBytes(memory(), Number(iovs), Number(count)));
  guard('fd_allocate', (_, offset, length) => BigInt(offset) + BigInt(length));
  guard('fd_filestat_set_size', (_, size) => BigInt(size));
}

/** The imports a program may have: WASI preview 1 functions the shim provides. Returns the first other one. */
export function foreignImport(module: WebAssembly.Module, provided: object): string | null {
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.module !== WASI_MODULE || entry.kind !== 'function' || !Object.hasOwn(provided, entry.name)) {
      return `${entry.module}.${entry.name}`;
    }
  }
  return null;
}

export interface ProgramOptions {
  /** argv[0] and the arguments after it. */
  args: string[];
  memoryBytes: number;
  /** Ask the page for input when the text runs out (needs JSPI). */
  interactive: boolean;
}

interface Jspi {
  Suspending: new (fn: (...args: number[]) => Promise<number>) => object;
  promising: (fn: unknown) => () => Promise<unknown>;
}

type Imports = Record<string, (...args: number[]) => number>;

/** The shim's imports with the run's random source, a cap on written files, and JSPI input when it is there. */
function wire(shim: WASI, root: Map<string, Inode>, input: Input, options: ProgramOptions, context: RunContext) {
  const imports = shim.wasiImport as Imports;
  imports.random_get = (pointer: number, length: number) => {
    const memory = (shim.inst.exports.memory as WebAssembly.Memory).buffer;
    context.randomBytes(new Uint8Array(memory, pointer, length));
    return defs.ERRNO_SUCCESS;
  };
  // The shim counts each argument in UTF-16 units, but args_get writes UTF-8 bytes. Counted that way, a non-ASCII
  // argument would overflow the buffer the program allocated for argv.
  imports.args_sizes_get = (countPointer: number, sizePointer: number) => {
    const view = new DataView((shim.inst.exports.memory as WebAssembly.Memory).buffer);
    const bytes = options.args.reduce((total, arg) => total + encoder.encode(arg).length + 1, 0);
    view.setUint32(countPointer, options.args.length, true);
    view.setUint32(sizePointer, bytes, true);
    return defs.ERRNO_SUCCESS;
  };
  budgetFiles(shim, root, options.memoryBytes, imports);
  const jspi = WebAssembly as unknown as Partial<Jspi>;
  const suspend = options.interactive && jspi.Suspending && jspi.promising ? (jspi as Jspi) : null;
  if (suspend) {
    input.suspends = true;
    const fdRead = imports.fd_read!;
    (imports as Record<string, unknown>).fd_read = new suspend.Suspending(async (fd: number, ...rest: number[]) => {
      if (fd === 0 && input.empty) input.push(await nextLine(context));
      return fdRead(fd, ...rest);
    });
  }
  return { imports, suspend };
}

/** Runs the program in `wasm` to its end and reports how it ended. */
export async function runProgram(
  wasm: Uint8Array,
  options: ProgramOptions,
  emit: Emit,
  context: RunContext,
): Promise<RunEnd> {
  const module = await WebAssembly.compile(wasm as Uint8Array<ArrayBuffer>);
  const decoders = { out: new TextDecoder(), err: new TextDecoder() };
  // The end of what the program wrote to its error stream, where libc++abi says a failed new stopped it.
  let errTail = '';
  const writer = (stream: 'out' | 'err') =>
    new ConsoleStdout((bytes) => {
      const text = decoders[stream].decode(bytes, { stream: true });
      if (stream === 'err') errTail = (errTail + text).slice(-512);
      emit({ kind: 'out', stream, text });
    });
  const line = (text: string) => emit({ kind: 'out', stream: 'err', text: phase(text) });
  const input = new Input(context);
  const { root, texts } = mountTree(context);
  const mount = new PreopenDirectory('.', root);
  const shim = new WASI(options.args, [], [input, writer('out'), writer('err'), mount], { debug: false });
  const { imports, suspend } = wire(shim, root, input, options, context);
  const foreign = foreignImport(module, imports);
  if (foreign !== null) {
    const message = say(codeStudioCpp.foreignImport, { name: foreign });
    line(message);
    return { status: 'error', message };
  }

  const instance = await WebAssembly.instantiate(module, { [WASI_MODULE]: imports as WebAssembly.ModuleImports });
  let end: RunEnd;
  try {
    shim.inst = instance as typeof shim.inst;
    const start = instance.exports._start as () => unknown;
    if (suspend) await suspend.promising(start)();
    else start();
    end = { status: 'ok', exitCode: 0, message: '' };
  } catch (error) {
    end = ended(error, instance.exports.memory as WebAssembly.Memory, options.memoryBytes, BAD_ALLOC.test(errTail));
  }
  for (const stream of ['out', 'err'] as const) {
    const rest = decoders[stream].decode();
    if (rest !== '') emit({ kind: 'out', stream, text: rest });
  }
  // The trap's reason reaches the console; the status line says only that the program stopped.
  if (end.status === 'error' && end.exitCode === undefined) line(end.message);
  keepWritten(root, texts, context);
  return end;
}

/** Hands the files the program changed to the overlay. A file over the overlay's file limit is not kept. */
function keepWritten(root: Map<string, Inode>, texts: Map<string, string>, context: RunContext): void {
  for (const [path, file] of filesIn(root)) {
    if (file.data.byteLength > PROJECT_LIMITS.fileBytes) continue;
    try {
      const text = new TextDecoder().decode(file.data);
      if (texts.get(path) !== text) context.files.write(path, text);
    } catch {
      // A file the engine cannot turn into text is not kept; the run's own end stands.
    }
  }
}

async function nextLine(context: RunContext): Promise<string | null> {
  const line = await context.stdin.lineAsync('');
  return line === null ? null : `${line}\n`;
}

/** How the program ended when _start did not return: exit(), a trap, or the engine's own limits. */
function ended(error: unknown, memory: WebAssembly.Memory, limit: number, badAlloc: boolean): RunEnd {
  if (error instanceof WASIProcExit) {
    const code = error.code | 0;
    return { status: code === 0 ? 'ok' : 'error', exitCode: code, message: '' };
  }
  // A trap close to the memory limit is the program running out of memory: new and malloc failed and it stopped.
  // In C++ a failed new aborts at once (there are no exceptions), even for one large request far below the limit.
  if (badAlloc || memory.buffer.byteLength + 64 * 1024 > limit) return { status: 'memory', message: 'memory' };
  const reason = error instanceof Error ? error.message : String(error);
  return { status: 'error', message: say(codeStudioCpp.trap, { reason }) };
}
