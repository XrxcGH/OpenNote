// The check worker's side of the live compiler check (checker.ts): it loads clang once, locks itself down, and
// answers each check request in turn.

import type { RunFile, RuntimeDiagnostic } from '../../contracts/run';
import { globalNames, lockDown } from '../../run/lockdown';
import type { ClangAdapter } from './adapter';
import type { CheckReply, CheckRequest } from './checker';
import type { ClangLanguage } from './flags';

const isFile = (value: unknown): value is RunFile =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as RunFile).path === 'string' &&
  typeof (value as RunFile).text === 'string';

function readRequest(value: unknown): CheckRequest | null {
  const request = value as Partial<CheckRequest> | null;
  if (request?.kind !== 'check' || typeof request.id !== 'number') return null;
  if (request.language !== 'c' && request.language !== 'cpp') return null;
  if (!isFile(request.file) || !Array.isArray(request.files) || !request.files.every(isFile)) return null;
  return request as CheckRequest;
}

interface CheckScope {
  postMessage(message: CheckReply): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/**
 * The check worker's side. The first request loads clang (before lockdown, while fetch is there); then the worker
 * locks down and answers every request in turn. A check that fails reports no items.
 */
export function serveChecks(
  adapters: Record<ClangLanguage, () => Promise<ClangAdapter>>,
  scope: CheckScope = globalThis as unknown as CheckScope,
): void {
  const send = scope.postMessage.bind(scope);
  const before = globalNames();
  let ready: Promise<Record<ClangLanguage, ClangAdapter>> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const load = () =>
    (ready ??= (async () => {
      const [c, cpp] = await Promise.all([adapters.c(), adapters.cpp()]);
      await c.load(() => {});
      await cpp.load(() => {});
      const added = [...globalNames()].filter((name) => !before.has(name));
      const left = lockDown(globalThis, added, []);
      if (left.length > 0) throw new Error(`lockdown: ${left.join(', ')}`);
      return { c, cpp };
    })());

  scope.addEventListener('message', (event) => {
    const request = readRequest(event.data);
    if (!request) return;
    queue = queue.then(async () => {
      let items: RuntimeDiagnostic[];
      try {
        const loaded = await load();
        items = await loaded[request.language].check(request.file, request.files);
      } catch {
        items = [];
      }
      send({ kind: 'checked', id: request.id, items });
    });
  });
}
