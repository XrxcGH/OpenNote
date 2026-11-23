// Lockdown parity with the code cells' sandbox: every name the code cells' old lockdown probe checked is on the run
// lockdown's FORBIDDEN list, and no allowance can keep one. run.test.tsx checks the same in a real worker.

import { describe, expect, it } from 'vitest';
import { ALLOWANCES } from './adapters';
import { FORBIDDEN, keptNames } from './lockdown';

// The names the code cells' own lockdown probe checked before code cells moved to the run core (the probe went with
// the old sandbox folder).
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

describe('lockdown parity', () => {
  it('forbids every name in the code cells’ lockdown probe', () => {
    expect(NAMES.length).toBeGreaterThan(30);
    expect(NAMES.filter((name) => !(FORBIDDEN as readonly string[]).includes(name))).toEqual([]);
  });

  it('keeps no forbidden name, whatever an adapter allows', () => {
    for (const allowances of [...Object.values(ALLOWANCES), FORBIDDEN]) {
      const kept = keptNames(['Module'], allowances);
      expect(FORBIDDEN.filter((name) => kept.has(name))).toEqual([]);
      const allowed = allowances.filter((name) => !(FORBIDDEN as readonly string[]).includes(name));
      expect(allowed.filter((name) => !kept.has(name))).toEqual([]);
    }
  });
});
