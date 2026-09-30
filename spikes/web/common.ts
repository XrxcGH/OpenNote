// Messages between a spike page and the harness in spikes/harness/src/common/webview.rs.
// The harness receives messages through window.ipc and calls page functions through window.__spike.

declare global {
  interface Window {
    ipc?: { postMessage(message: string): void };
    __spike: { call(id: number, name: string, args: unknown): void };
  }
}

export interface Message {
  type: string;
  [key: string]: unknown;
}

/** Sends a message to the harness. In a plain browser, where there is no harness, it logs instead. */
export function send(message: Message): void {
  if (window.ipc) window.ipc.postMessage(JSON.stringify(message));
  else console.log('spike message', message);
}

const handlers = new Map<string, (args: unknown) => unknown>();

/** Makes a function callable from the harness with Controller::call. It may return a promise. */
export function register<A, R>(name: string, handler: (args: A) => R | Promise<R>): void {
  handlers.set(name, handler as (args: unknown) => unknown);
}

window.__spike = {
  call(id, name, args) {
    const handler = handlers.get(name);
    Promise.resolve()
      .then(() => {
        if (!handler) throw new Error(`The page has no function named ${name}.`);
        return handler(args);
      })
      .then(
        (value) => send({ type: 'reply', id, ok: true, value: value ?? null }),
        (error: unknown) => send({ type: 'reply', id, ok: false, error: String(error) }),
      );
  },
};

/** Options from the query string, such as ?mode=canvas2d&auto=1. */
export const params = new URLSearchParams(location.search);

/** True when the harness is running an automated measurement rather than a person trying the page. */
export const isAuto = params.get('auto') === '1';

/** Tells the harness the page is ready, with anything it needs, such as where to aim input. */
export function ready(details: Record<string, unknown> = {}): void {
  send({ type: 'ready', ...details });
}

/** Resolves at the start of the next frame, with the frame's timestamp. */
export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
