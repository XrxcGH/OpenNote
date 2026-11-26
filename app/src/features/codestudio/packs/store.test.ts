import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStores } from '../../../state/store';
import type { PackInfo, PackList } from '../contracts';
import { packFileUrl } from './client';
import type { PacksClient } from './client';
import {
  anyPackDownloading,
  describePackError,
  downloadPack,
  formatSize,
  packStateLine,
  packsState,
  refreshPacks,
  removePack,
  setPacksClient,
} from './store';

const ui = vi.hoisted(() => ({
  confirm: vi.fn(async (_options: { title: string; body: string }) => true),
  showToast: vi.fn(),
  announce: vi.fn(),
}));
vi.mock('../../../ui', () => ui);

const PYODIDE: PackInfo = {
  id: 'pyodide',
  name: 'Python (full)',
  detail: 'CPython 3.14.2 with the whole standard library, through Pyodide.',
  version: '314.0.7',
  bytes: 13_531_207,
  license: 'MPL-2.0',
  depends: [],
  state: { kind: 'absent' },
};

function fakeClient(list: PackList, fail?: { code: string; message: string }) {
  const calls: string[] = [];
  const client: PacksClient = {
    list: async () => {
      calls.push('list');
      return list;
    },
    download: async (pack) => {
      calls.push(`download ${pack}`);
      if (fail) throw fail;
    },
    cancel: async (pack) => void calls.push(`cancel ${pack}`),
    remove: async (pack) => void calls.push(`remove ${pack}`),
  };
  return { client, calls };
}

beforeEach(() => {
  resetStores();
  ui.confirm.mockClear();
  ui.showToast.mockClear();
  setPacksClient(undefined);
});

describe('the download dialog', () => {
  it('shows the size and license before any byte moves', async () => {
    const { client, calls } = fakeClient({ packs: [PYODIDE], blocked: null });
    setPacksClient(client);
    expect(await downloadPack(PYODIDE)).toBe(true);
    expect(ui.confirm).toHaveBeenCalledTimes(1);
    const asked = ui.confirm.mock.calls[0]![0];
    expect(asked.title).toBe('Download Python (full)?');
    expect(asked.body).toBe('This downloads 13.5 MB once. After that it works offline. License: MPL-2.0.');
    expect(calls).toEqual(['download pyodide', 'list']);
  });

  it('does nothing when the person says no', async () => {
    const { client, calls } = fakeClient({ packs: [PYODIDE], blocked: null });
    setPacksClient(client);
    ui.confirm.mockResolvedValueOnce(false);
    expect(await downloadPack(PYODIDE)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('resumes a partial download without asking again', async () => {
    const { client, calls } = fakeClient({ packs: [PYODIDE], blocked: null });
    setPacksClient(client);
    const partial: PackInfo = { ...PYODIDE, state: { kind: 'partial', receivedBytes: 5, totalBytes: 13_531_207 } };
    expect(await downloadPack(partial)).toBe(true);
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(calls).toEqual(['download pyodide', 'list']);
  });
});

describe('refusals', () => {
  it('Work offline blocks a pack download with the documented message', async () => {
    const offline = { code: 'offline', message: 'Work offline is on. Turn it off to download this pack.' };
    const { client } = fakeClient({ packs: [PYODIDE], blocked: 'offline' }, offline);
    setPacksClient(client);
    expect(await downloadPack(PYODIDE)).toBe(false);
    expect(ui.showToast).toHaveBeenCalledWith({
      message: 'Work offline is on. Turn it off to download this pack.',
      tone: 'danger',
    });
    // The interface's words are the shell's words.
    expect(describePackError('offline')).toBe(offline.message);
    const blocked: PackInfo = { ...PYODIDE, state: { kind: 'blocked', reason: 'offline' } };
    expect(packStateLine(blocked)).toBe(offline.message);
  });

  it('names safe mode, a bad checksum, and an unknown code', () => {
    expect(describePackError('safeMode')).toBe('Safe mode is on. Restart OpenNote normally to download this pack.');
    expect(describePackError('checksum')).toMatch(/expected one, so it was deleted/);
    expect(describePackError('something')).toBe('Something went wrong. Try again.');
  });
});

describe('the list', () => {
  it('reads the list, says when it downloads, and has no shell in a browser', async () => {
    const downloading: PackInfo = {
      ...PYODIDE,
      state: { kind: 'downloading', receivedBytes: 6_000_000, totalBytes: 13_531_207 },
    };
    const { client } = fakeClient({ packs: [downloading], blocked: null });
    setPacksClient(client);
    const list = await refreshPacks();
    expect(anyPackDownloading(list)).toBe(true);
    expect(packStateLine(downloading)).toBe('Downloading: 6 MB of 13.5 MB.');
    setPacksClient(null);
    expect(await refreshPacks()).toBeNull();
    expect(packsState.get().failed).toBe(true);
  });

  it('removes a pack after the person confirms', async () => {
    const ready: PackInfo = { ...PYODIDE, state: { kind: 'ready', bytes: 13_531_207 } };
    const { client, calls } = fakeClient({ packs: [ready], blocked: null });
    setPacksClient(client);
    expect(await removePack(ready)).toBe(true);
    expect(ui.confirm.mock.calls[0]![0].title).toBe('Remove Python (full)?');
    expect(calls).toEqual(['remove pyodide', 'list']);
  });

  it('formats sizes the way the Models panel does', () => {
    expect(formatSize(105_495_211)).toBe('105.5 MB');
    expect(formatSize(787)).toBe('1 KB');
  });
});

describe('pack addresses', () => {
  it('reach the read-only scheme', () => {
    expect(packFileUrl('pyodide/pyodide.mjs', true)).toBe('http://opennote-pack.localhost/pyodide/pyodide.mjs');
    expect(packFileUrl('/clang/llvm.core.wasm', false)).toBe('opennote-pack://localhost/clang/llvm.core.wasm');
  });
});
