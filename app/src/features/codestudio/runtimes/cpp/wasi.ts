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
  PreopenDirectory,
  WASI,
  WASIProcExit,
  wasi as defs,
} from '@bjorn3/browser_wasi_shim';
import type { Emit, RunContext, RunEnd } from '../../contracts/run';
import { codeStudioCpp } from '../../../../strings/en/codeStudio/cpp';
import { say } from './say';

const WASI_MODULE = 'wasi_snapshot_preview1';
const encoder = new TextEncoder();

/** Standard input as a character device that reads the run's input. */
class Input extends Fd {
  private queue = new Uint8Array(0);
  private ended = false;

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
    if (this.empty) this.push(this.context.stdin.read());
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
  // Files the program writes stay inside the run's memory limit.
  const fdWrite = imports.fd_write!;
  imports.fd_write = (fd: number, ...rest: number[]) =>
    fd > 3 && bytesIn(root) > options.memoryBytes ? defs.ERRNO_NOSPC : fdWrite(fd, ...rest);
  const jspi = WebAssembly as unknown as Partial<Jspi>;
  const suspend = options.interactive && jspi.Suspending && jspi.promising ? (jspi as Jspi) : null;
  if (suspend) {
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
  const writer = (stream: 'out' | 'err') =>
    new ConsoleStdout((bytes) => emit({ kind: 'out', stream, text: decoders[stream].decode(bytes, { stream: true }) }));
  const input = new Input(context);
  const { root, texts } = mountTree(context);
  const mount = new PreopenDirectory('.', root);
  const shim = new WASI(options.args, [], [input, writer('out'), writer('err'), mount], { debug: false });
  const { imports, suspend } = wire(shim, root, input, options, context);
  const foreign = foreignImport(module, imports);
  if (foreign !== null) return { status: 'error', message: say(codeStudioCpp.foreignImport, { name: foreign }) };

  const instance = await WebAssembly.instantiate(module, { [WASI_MODULE]: imports as WebAssembly.ModuleImports });
  let end: RunEnd;
  try {
    shim.inst = instance as typeof shim.inst;
    const start = instance.exports._start as () => unknown;
    if (suspend) await suspend.promising(start)();
    else start();
    end = { status: 'ok', exitCode: 0, message: '' };
  } catch (error) {
    end = ended(error, instance.exports.memory as WebAssembly.Memory, options.memoryBytes);
  }
  for (const stream of ['out', 'err'] as const) {
    const rest = decoders[stream].decode();
    if (rest !== '') emit({ kind: 'out', stream, text: rest });
  }
  for (const [path, file] of filesIn(root)) {
    const text = new TextDecoder().decode(file.data);
    if (texts.get(path) !== text) context.files.write(path, text);
  }
  return end;
}

async function nextLine(context: RunContext): Promise<string | null> {
  const line = await context.stdin.lineAsync('');
  return line === null ? null : `${line}\n`;
}

/** How the program ended when _start did not return: exit(), a trap, or the engine's own limits. */
function ended(error: unknown, memory: WebAssembly.Memory, limit: number): RunEnd {
  if (error instanceof WASIProcExit) {
    const code = error.code | 0;
    return { status: code === 0 ? 'ok' : 'error', exitCode: code, message: '' };
  }
  // A trap close to the memory limit is the program running out of memory: new and malloc failed and it stopped.
  if (memory.buffer.byteLength + 64 * 1024 > limit) return { status: 'memory', message: 'memory' };
  const reason = error instanceof Error ? error.message : String(error);
  return { status: 'error', message: say(codeStudioCpp.trap, { reason }) };
}
