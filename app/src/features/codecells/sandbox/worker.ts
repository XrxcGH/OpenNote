// The sandbox worker of one code cell run (docs/help/code-cells.md). It takes one run request, loads that language's
// runtime, empties its own global object (lockdown.ts), runs the cell, and reports. The page ends the worker when it
// reports, at the time limit, or at Stop, so no state is kept from one run to the next.
import { globalNames, lockDown } from './lockdown';
import { Output } from './output';
import { LIMITS, isLanguage } from './protocol';
import type { Limits, RunRequest, WorkerMessage } from './protocol';
import type { Ran } from './python';

const scope = globalThis as unknown as {
  postMessage(message: WorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void, options: { once: true }): void;
};
// Kept before lockdown takes postMessage off the global, so only this file can talk to the page.
const send = scope.postMessage.bind(scope);
const before = globalNames();

/** The request's limits, never above the page's own. */
function limitsOf(asked: Partial<Limits> | undefined): Limits {
  const pick = (key: keyof Limits) => {
    const value = asked?.[key];
    return typeof value === 'number' && value > 0 ? Math.min(value, LIMITS[key]) : LIMITS[key];
  };
  return {
    timeMs: pick('timeMs'),
    loadMs: pick('loadMs'),
    memoryBytes: pick('memoryBytes'),
    stackBytes: pick('stackBytes'),
    outputChars: pick('outputChars'),
    sourceChars: pick('sourceChars'),
  };
}

async function run(request: Partial<RunRequest>): Promise<void> {
  if (!isLanguage(request.language) || typeof request.source !== 'string') {
    send({ kind: 'done', status: 'failed', message: 'request' });
    return;
  }
  const limits = limitsOf(request.limits);
  const output = new Output(send, limits.outputChars);
  const source = request.source.slice(0, limits.sourceChars);
  let runCell: (deadline: number) => Ran;
  if (request.language === 'python') {
    const { preparePython } = await import('./python');
    const python = await preparePython(output, limits);
    runCell = () => python(source);
  } else {
    const { prepareJavaScript } = await import('./javascript');
    const javascript = await prepareJavaScript(output, limits);
    runCell = (deadline) => javascript(source, deadline);
  }
  const added = new Set([...globalNames()].filter((name) => !before.has(name)));
  const left = lockDown(globalThis, added);
  if (left.length > 0) {
    send({ kind: 'done', status: 'failed', message: `lockdown: ${left.join(', ')}` });
    return;
  }
  send({ kind: 'started' });
  const ran = runCell(Date.now() + limits.timeMs);
  output.flush();
  if (output.truncated) send({ kind: 'out', stream: 'err', text: '\n…' });
  send({ kind: 'done', status: ran.status, message: ran.message });
}

scope.addEventListener(
  'message',
  (event) => {
    run(event.data as Partial<RunRequest>).catch((error: unknown) =>
      send({ kind: 'done', status: 'failed', message: String((error as Error)?.message ?? error) }),
    );
  },
  { once: true },
);
