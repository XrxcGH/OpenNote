// A worker for run.test.tsx only: takes a list of allowances, locks itself down with them as a run worker does, and
// reports which forbidden names are left, so the test can check that no adapter's allowances bring one back.
import { FORBIDDEN, lockDown } from '../lockdown';

const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void, options: { once: true }): void;
};
const send = scope.postMessage.bind(scope);

scope.addEventListener(
  'message',
  (event) => {
    const left = lockDown(globalThis, [], event.data as string[]);
    const present = FORBIDDEN.filter((name) => (globalThis as Record<string, unknown>)[name] !== undefined);
    const makers = [function () {}, async function () {}, function* () {}, async function* () {}].map((maker) => {
      try {
        (maker.constructor as (body: string) => unknown)('return 1');
        return 'made';
      } catch {
        return 'blocked';
      }
    });
    send({ left, present, makers });
  },
  { once: true },
);
