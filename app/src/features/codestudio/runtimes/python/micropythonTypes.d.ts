// Types for the part of MicroPython's WebAssembly port that code cells use. The package ships no types.
declare module '@micropython/micropython-webassembly-pyscript' {
  export interface MicroPython {
    runPython(code: string): unknown;
  }
  export function loadMicroPython(options: {
    url?: string;
    heapsize?: number;
    pystack?: number;
    linebuffer?: boolean;
    stdout?: (bytes: Uint8Array) => void;
    stderr?: (bytes: Uint8Array) => void;
  }): Promise<MicroPython>;
}
