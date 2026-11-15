// The memory limit for both Python runtimes. Each runtime's heap is a WebAssembly memory that Emscripten grows when
// an allocation does not fit. Emscripten takes a refused `grow` as an allocation that failed, so Python raises
// MemoryError and the run ends as "memory". Neither runtime exports its memory object to the page, so `grow` is
// wrapped once on the prototype, and each heap says which memory is its own.

/** Bytes in one WebAssembly page. */
const PAGE = 65_536;

interface Capped {
  owns(memory: WebAssembly.Memory): boolean;
  cap: number;
}

const capped: Capped[] = [];

function wrapGrow(): void {
  const proto = WebAssembly.Memory.prototype as WebAssembly.Memory & { onCapped?: true };
  if (proto.onCapped) return;
  const grow = proto.grow;
  Object.defineProperty(proto, 'grow', {
    configurable: true,
    writable: true,
    value: function (this: WebAssembly.Memory, delta: number): number {
      const heap = capped.find((item) => item.owns(this));
      if (heap && this.buffer.byteLength + delta * PAGE > heap.cap) {
        throw new RangeError('The run has no more memory.');
      }
      return grow.call(this, delta);
    },
  });
  Object.defineProperty(proto, 'onCapped', { value: true });
}

/**
 * Caps how far one heap may grow. `owns` tells the heap's memory from others, and `size` is its size in bytes now.
 * Returns the setter of the cap, in bytes past the size at this call, which is the size after the runtime loaded.
 */
export function capHeap(owns: (memory: WebAssembly.Memory) => boolean, size: () => number): (bytes: number) => void {
  wrapGrow();
  const entry: Capped = { owns, cap: Infinity };
  capped.push(entry);
  const base = size();
  return (bytes) => {
    entry.cap = base + bytes;
  };
}

/** A node of Emscripten's file system, as far as the file cap reads it. MEMFS files keep their size in usedBytes. */
interface FileNode {
  mode: number;
  usedBytes?: number;
  contents?: unknown;
  mounted?: { root: FileNode } | null;
}

/** The part of Emscripten's FS object the file cap uses. */
export interface CappedFS {
  root: FileNode;
  isFile(mode: number): boolean;
  isDir(mode: number): boolean;
  lookupPath(path: string): { node: FileNode };
  writeFile(path: string, data: string): void;
  unlink(path: string): void;
  ErrnoError: new (errno: number) => Error;
}

type StreamWrite = (
  stream: { node: FileNode },
  buffer: unknown,
  offset: number,
  length: number,
  position: number,
  own?: boolean,
) => number;
type SetAttr = (node: FileNode, attr: { size?: number }) => void;

/** Emscripten's errno for "No space left on device"; Python raises OSError with errno.ENOSPC. */
const ENOSPC = 51;

/** The bytes in every MEMFS file under the root, mounts included. */
function fileBytes(fs: CappedFS): number {
  let total = 0;
  const seen = new Set<FileNode>();
  const visit = (node: FileNode) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.mounted) visit(node.mounted.root);
    if (fs.isFile(node.mode)) total += node.usedBytes ?? 0;
    else if (fs.isDir(node.mode) && node.contents && typeof node.contents === 'object') {
      for (const child of Object.values(node.contents as Record<string, FileNode>)) visit(child);
    }
  };
  visit(fs.root);
  return total;
}

const fileCaps = new WeakMap<CappedFS, (bytes: number | null) => void>();

/**
 * Caps the file data a run may add to the in-memory file system, which lives outside the WebAssembly heap. Each write
 * and size change of an MEMFS file is checked. One that takes the files more than `bytes` past their size at this call
 * fails with ENOSPC, so Python raises OSError. `null` lifts the cap. The file at `spare` may use `reserve` bytes more:
 * it is the run's own state file, written after the program.
 */
export function capFiles(
  fs: CappedFS,
  scratch: string,
  spare: string,
  reserve: number,
): (bytes: number | null) => void {
  const known = fileCaps.get(fs);
  if (known) return known;
  let cap = Infinity;
  let used = 0;
  let spareNode: FileNode | null = null;
  const grow = (node: FileNode, size: number) => {
    const growth = size - (node.usedBytes ?? 0);
    if (growth <= 0 || cap === Infinity) return;
    const room = cap + (node === spareNode ? reserve : 0);
    // `used` misses files removed since the last count, so it is counted again before a write is refused.
    if (used + growth > room) used = fileBytes(fs);
    if (used + growth > room) throw new fs.ErrnoError(ENOSPC);
    used += growth;
  };
  // MEMFS files share one table of stream functions and one of node functions; a file made here finds them.
  const probe = `${scratch}/.cap`;
  fs.writeFile(probe, '');
  const sample = fs.lookupPath(probe).node as FileNode & {
    stream_ops: { write: StreamWrite };
    node_ops: { setattr: SetAttr };
  };
  fs.unlink(probe);
  const streamOps = sample.stream_ops;
  const nodeOps = sample.node_ops;
  const write = streamOps.write;
  streamOps.write = function (this: unknown, ...args: Parameters<StreamWrite>) {
    const [stream, , , length, position] = args;
    grow(stream.node, Math.max(stream.node.usedBytes ?? 0, position + length));
    return write.apply(this, args);
  };
  const setattr = nodeOps.setattr;
  nodeOps.setattr = function (node, attr) {
    if (typeof attr.size === 'number') grow(node, attr.size);
    setattr.call(this, node, attr);
  };
  const limit = (bytes: number | null) => {
    used = fileBytes(fs);
    cap = bytes === null ? Infinity : used + bytes;
    if (bytes === null) return;
    try {
      fs.writeFile(spare, '');
      spareNode = fs.lookupPath(spare).node;
    } catch {
      spareNode = null;
    }
  };
  fileCaps.set(fs, limit);
  return limit;
}

type Instantiate = (...args: unknown[]) => Promise<unknown>;

/**
 * Runs `load` and returns the memory of the WebAssembly instance it makes that exports `marker`. It watches
 * WebAssembly.instantiate and instantiateStreaming while `load` runs, and puts both back after.
 */
export async function loadWithMemory<T>(
  marker: string,
  load: () => Promise<T>,
): Promise<{ value: T; memory: WebAssembly.Memory | null }> {
  const wasm = WebAssembly as unknown as Record<'instantiate' | 'instantiateStreaming', Instantiate | undefined>;
  const originals = { instantiate: wasm.instantiate, instantiateStreaming: wasm.instantiateStreaming };
  let memory: WebAssembly.Memory | null = null;
  const watch = (original: Instantiate | undefined) =>
    original &&
    (async (...args: unknown[]) => {
      const made = (await original.apply(WebAssembly, args)) as { instance?: WebAssembly.Instance; exports?: unknown };
      const exports = (made.instance ?? (made as WebAssembly.Instance)).exports;
      if (exports && marker in exports && exports.memory instanceof WebAssembly.Memory) memory = exports.memory;
      return made;
    });
  wasm.instantiate = watch(originals.instantiate);
  wasm.instantiateStreaming = watch(originals.instantiateStreaming);
  try {
    return { value: await load(), memory };
  } finally {
    wasm.instantiate = originals.instantiate;
    wasm.instantiateStreaming = originals.instantiateStreaming;
  }
}
