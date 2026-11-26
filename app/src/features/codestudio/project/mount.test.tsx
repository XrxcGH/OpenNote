// The code project card: name, language, and file count, with Run and Open in Code studio. A project from a newer
// app shows read-only with its fallback and never patches. Import goes through the store as one patch.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_PROJECT_VERSION } from '../contracts';
import { starterProject } from './model';
import { mountCodeProject } from './mount';
import { setStudioTarget, studioTarget } from './studioTarget';

const mounted: { destroy(): void; container: HTMLElement }[] = [];

function mountCard(data: Record<string, unknown>, readOnly = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const patch = vi.fn();
  const announce = vi.fn();
  const handle = mountCodeProject(container, { block: 'b1', data, readOnly, patch, announce });
  mounted.push({ destroy: handle.destroy, container });
  return { patch, announce, handle };
}

function twoFiles(): Record<string, unknown> {
  const project = starterProject('Two sum', 'print(1)\n');
  project.files.f02 = { path: 'data/input.txt', text: '2 7\n', order: 1 };
  return project as unknown as Record<string, unknown>;
}

afterEach(() => {
  for (const one of mounted.splice(0)) {
    one.destroy();
    one.container.remove();
  }
  setStudioTarget(null);
});

afterAll(async () => (await import('../../tools')).resetToolWindows());

describe('code project card', () => {
  it('shows the name, language, and file count, and opens the studio on the block', async () => {
    mountCard(twoFiles());
    expect(await screen.findByText('Two sum')).toBeTruthy();
    expect(screen.getByText(/Python · 2 files/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Code studio' }));
    expect(studioTarget()).toEqual({ block: 'b1', run: false });
    // The studio opens as a tool window, titled by the tool window entry.
    await waitFor(() => expect(document.getElementById('tool-windows')?.textContent).toContain('Code studio'));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(studioTarget()).toEqual({ block: 'b1', run: true });
  });

  it('shows a project from a newer app read-only with its fallback, and never patches', async () => {
    const { patch } = mountCard({ ...twoFiles(), minEditor: CODE_PROJECT_VERSION + 1 });
    expect(await screen.findByText(/needs a newer version of OpenNote/)).toBeTruthy();
    expect(screen.getByText(/#### data\/input.txt/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import files' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export as .zip' })).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it('imports picked files as one patch and says what it did', async () => {
    const { patch, announce } = mountCard(twoFiles());
    const input = (await screen.findByLabelText(
      'Choose files or a .zip to import into the project',
    )) as HTMLInputElement;
    const file = new File(['def helper():\n    return 1\n'], 'helper.py', { type: 'text/x-python' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    const [data, fallback] = patch.mock.calls[0];
    expect(data).toEqual({ files: { f03: { path: 'helper.py', text: 'def helper():\n    return 1\n', order: 2 } } });
    expect(fallback).toContain('#### helper.py');
    expect(announce).toHaveBeenCalledWith('Imported 1 file.');
  });

  it('hides Import on a read-only page', async () => {
    mountCard(twoFiles(), true);
    expect(await screen.findByText(/Read-only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Import files' })).toBeNull();
  });
});
