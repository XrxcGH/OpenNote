// The check worker's side of the live compiler check (checker.ts): it loads clang once, locks itself down, and
// answers each check request in turn.

import type { RunFile, RuntimeDiagnostic } from '../../contracts/run';
import { globalNames, lockDown } from '../../run/lockdown';
import type { ClangAdapter } from './adapter';
import type { CheckBegun, CheckReply, CheckRequest } from './checker';
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
  postMessage(message: CheckReply | CheckBegun): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/**
 * The check worker's side. The first request loads clang (before lockdown, while fetch is there); then the worker
 * locks down and answers every request in turn. It says when it begins each check, so the page times the check and
 * not the load or the queue. A check that a newer request for the same file replaced reports nothing and does not
 * run. A check that fails reports no items. A load that fails is not kept: the reply says so, and the next check
 * loads again.
 */
export function serveChecks(
  adapters: Record<ClangLanguage, () => Promise<ClangAdapter>>,
  scope: CheckScope = globalThis as unknown as CheckScope,
): void {
  const send = scope.postMessage.bind(scope);
  const before = globalNames();
  let ready: Promise<Record<ClangLanguage, ClangAdapter>> | null = null;
  let queue: Promise<void> = Promise.resolve();
  /** The newest request for each file path. */
  const newest = new Map<string, number>();

  const load = () =>
    (ready ??= (async () => {
      try {
        const [c, cpp] = await Promise.all([adapters.c(), adapters.cpp()]);
        await c.load(() => {});
        await cpp.load(() => {});
        const added = [...globalNames()].filter((name) => !before.has(name));
        const left = lockDown(globalThis, added, []);
        if (left.length > 0) throw new Error(`lockdown: ${left.join(', ')}`);
        return { c, cpp };
      } catch (error) {
        ready = null;
        throw error;
      }
    })());

  scope.addEventListener('message', (event) => {
    const request = readRequest(event.data);
    if (!request) return;
    newest.set(request.file.path, request.id);
    queue = queue.then(async () => {
      if (newest.get(request.file.path) !== request.id) return send({ kind: 'checked', id: request.id, items: [] });
      let loaded: Record<ClangLanguage, ClangAdapter>;
      try {
        loaded = await load();
      } catch {
        return send({ kind: 'checked', id: request.id, items: [], failed: true });
      }
      send({ kind: 'checking', id: request.id });
      let items: RuntimeDiagnostic[];
      try {
        items = await loaded[request.language].check(request.file, request.files);
      } catch {
        items = [];
      }
      send({ kind: 'checked', id: request.id, items });
    });
  });
}
