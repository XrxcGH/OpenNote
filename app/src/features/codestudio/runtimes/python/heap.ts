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
