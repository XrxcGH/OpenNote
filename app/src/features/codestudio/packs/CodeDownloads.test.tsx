// The Code group of the Models panel: each runtime pack with its exact size, a Download button that asks first, and
// Remove for a downloaded pack. Work offline turns Download off and says why.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import type { PackInfo, PackList } from '../contracts';
import CodeDownloads from './CodeDownloads';
import type { PacksClient } from './client';
import { setPacksClient } from './store';

const pack = (id: PackInfo['id'], name: string, bytes: number, state: PackInfo['state']): PackInfo => ({
  id,
  name,
  detail: '',
  version: '1.0.0',
  bytes,
  license: 'MIT',
  depends: [],
  state,
});

function useList(list: PackList): string[] {
  const calls: string[] = [];
  const client: PacksClient = {
    list: async () => list,
    download: async (id) => void calls.push(`download ${id}`),
    cancel: async (id) => void calls.push(`cancel ${id}`),
    remove: async (id) => void calls.push(`remove ${id}`),
  };
  setPacksClient(client);
  return calls;
}

afterEach(() => setPacksClient(undefined));

describe('the Code group', () => {
  it('lists the packs with their sizes and asks before a download', async () => {
    const calls = useList({
      packs: [
        pack('pyodide', 'Python (full)', 13_531_207, { kind: 'absent' }),
        pack('clang', 'C and C++', 105_495_211, { kind: 'ready', bytes: 105_495_211 }),
      ],
      blocked: null,
    });
    renderUi(<CodeDownloads styles={{}} />);
    const python = (await screen.findByText('Python (full) 1.0.0')).closest('li')!;
    expect(within(python).getByText('13.5 MB')).toBeTruthy();
    expect(within(python).getByText('Not downloaded.')).toBeTruthy();
    const clang = screen.getByText('C and C++ 1.0.0').closest('li')!;
    expect(within(clang).getByRole('button', { name: 'Remove C and C++' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Download Python (full), 13.5 MB' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('This downloads 13.5 MB once. After that it works offline. License: MIT.'),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    await expect.poll(() => calls).toEqual(['download pyodide']);
    await expectNoAxeViolations(document.getElementById('code-downloads')!);
  });

  it('turns Download off while Work offline is on and says why', async () => {
    useList({
      packs: [pack('pyodide', 'Python (full)', 13_531_207, { kind: 'blocked', reason: 'offline' })],
      blocked: 'offline',
    });
    renderUi(<CodeDownloads styles={{}} />);
    const button = await screen.findByRole('button', { name: 'Download Python (full), 13.5 MB' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Work offline is on. Turn it off to download this pack.')).toBeTruthy();
  });

  it('shows the code models the panel passes in, in the same list', async () => {
    useList({ packs: [], blocked: null });
    renderUi(
      <CodeDownloads styles={{}}>
        <li>Code model</li>
      </CodeDownloads>,
    );
    const list = await screen.findByRole('list', { name: 'Code' });
    expect(within(list).getByText('Code model')).toBeTruthy();
  });
});
