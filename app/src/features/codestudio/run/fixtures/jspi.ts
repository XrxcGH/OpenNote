// A test runtime for run.test.tsx only, and the JSPI spike of gate G-R5 (DESIGN 4.4): a hand-assembled WebAssembly
// program that calls an imported `ask` twice and returns the sum. With JSPI, `ask` is a WebAssembly.Suspending
// import: the program pauses while the page asks the person for a number, and resumes with the reply.
import type { RunEnd, RuntimeAdapter } from '../../contracts/run';
import { ALLOWANCES } from '../adapters';

/** (module (type (func (result i32))) (import "env" "ask" (func 0)) (func (export "run") call 0 call 0 i32.add)) */
// prettier-ignore
const BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic and version 1
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, // type section: () -> i32
  0x02, 0x0b, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x03, 0x61, 0x73, 0x6b, 0x00, 0x00, // import env.ask, type 0
  0x03, 0x02, 0x01, 0x00, // function section: one function of type 0
  0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x01, // export "run" = function 1
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x10, 0x00, 0x10, 0x00, 0x6a, 0x0b, // code: call 0, call 0, i32.add, end
]);

interface Jspi {
  Suspending: new (fn: () => Promise<number>) => WebAssembly.ImportValue;
  promising: (fn: unknown) => () => Promise<number>;
}

let module: WebAssembly.Module | null = null;

export const jspiFixture: RuntimeAdapter = {
  id: 'lua',
  version: 'JSPI test fixture',
  allowances: ALLOWANCES.lua,
  async load() {
    module = await WebAssembly.compile(BYTES);
  },
  async run(_request, emit, context): Promise<RunEnd> {
    let sum: number;
    if (context.stdin.interactive) {
      const jspi = WebAssembly as unknown as Jspi;
      const ask = new jspi.Suspending(async () => Number((await context.stdin.lineAsync('number? ')) ?? 0));
      const instance = new WebAssembly.Instance(module!, { env: { ask } });
      sum = await jspi.promising(instance.exports.run)();
    } else {
      // Without JSPI the import cannot wait, so it reads the prefilled input.
      const ask = () => Number(context.stdin.line() ?? 0);
      const instance = new WebAssembly.Instance(module!, { env: { ask } });
      sum = (instance.exports.run as () => number)();
    }
    emit({ kind: 'out', stream: 'out', text: `${sum}\n` });
    return { status: 'ok', message: '', exitCode: 0 };
  },
};
