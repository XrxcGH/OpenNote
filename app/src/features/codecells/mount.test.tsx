// A code cell from a newer app is shown read-only and never saved, so an older app cannot relabel it as Python.
// That means an unknown language, or a minEditor above what this app knows. Known cells still edit and save.
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackOf, mountCodeCell } from './mount';

const mounted: { destroy(): void; container: HTMLElement }[] = [];

function mountCell(data: Record<string, unknown>) {
  const container = document.createElement('div');
  document.body.append(container);
  const patch = vi.fn();
  const handle = mountCodeCell(container, { data, readOnly: false, patch, announce: () => undefined });
  mounted.push({ destroy: handle.destroy, container });
  return { patch, container };
}

afterEach(() => {
  for (const one of mounted.splice(0)) {
    one.destroy();
    one.container.remove();
  }
  vi.useRealTimers();
});

const NEWER = 'This code cell needs a newer version of OpenNote';

describe('mountCodeCell forward compatibility', () => {
  it('shows a TypeScript cell read-only, with its code, and never patches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const source = 'const x: number = 1;\n';
    const { patch } = mountCell({ language: 'typescript', source });
    expect(await screen.findByText(NEWER)).toBeTruthy();
    expect(screen.getByText('Language: typescript')).toBeTruthy();
    const code = screen.getByRole('textbox', { name: 'Code' }) as HTMLTextAreaElement;
    expect(code.value).toBe(source);
    expect(code.readOnly).toBe(true);
    expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    fireEvent.change(code, { target: { value: 'edited' } });
    fireEvent.keyDown(code, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(code, { key: 'Tab' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(code.value).toBe(source);
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows a cell with minEditor 2 read-only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { patch } = mountCell({ language: 'python', source: 'print(1)\n', minEditor: 2 });
    expect(await screen.findByText(NEWER)).toBeTruthy();
    const code = screen.getByRole('textbox', { name: 'Code' }) as HTMLTextAreaElement;
    expect(code.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    fireEvent.change(code, { target: { value: 'print(2)' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('still edits and saves a Python cell with no minEditor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { patch } = mountCell({ language: 'python', source: 'x = 1\n' });
    const code = (await screen.findByRole('textbox', { name: 'Code' })) as HTMLTextAreaElement;
    expect(code.readOnly).toBe(false);
    expect(screen.queryByText(NEWER)).toBeNull();
    fireEvent.change(code, { target: { value: 'x = 2\n' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(patch).toHaveBeenCalledWith({ language: 'python', source: 'x = 2\n' }, fallbackOf('python', 'x = 2\n'));
  });
});
