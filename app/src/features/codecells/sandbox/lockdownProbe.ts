// A worker for sandbox.test.tsx only: locks itself down as a cell's worker does, then reports what is left of the
// browser, so the test can check that no way out remains.
import { lockDown } from './lockdown';

const send = globalThis.postMessage.bind(globalThis) as (message: unknown) => void;
const left = lockDown(globalThis, new Set());

const NAMES = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'navigator',
  'location',
  'postMessage',
  'setTimeout',
  'setInterval',
  'eval',
  'Function',
  'self',
  'close',
  'Request',
  'Response',
  'Blob',
  'FileReader',
  'FileReaderSync',
  'URL',
  'OffscreenCanvas',
  'Notification',
  'addEventListener',
  'MessageChannel',
  'queueMicrotask',
  'structuredClone',
  'reportError',
  'console',
  'origin',
  'onmessage',
];

const present = NAMES.filter((name) => (globalThis as Record<string, unknown>)[name] !== undefined);
const makers = [function () {}, async function () {}, function* () {}, async function* () {}].map((maker) => {
  try {
    (maker.constructor as (body: string) => unknown)('return 1');
    return 'made';
  } catch {
    return 'blocked';
  }
});
send({ left, present, makers, kept: typeof WebAssembly + typeof TextDecoder + typeof crypto });
