// A code cell from a newer app is shown read-only and never saved, so an older app cannot relabel it as Python.
// That means an unknown language, or a minEditor above what this app knows. Known cells still edit and save: a
// version 1 cell opens and runs unchanged, and a version 2 TypeScript cell runs. needsNewerApp(data, 1) simulates an
// app from before the newer languages.
import { EditorView } from '@codemirror/view';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { needsNewerApp } from './model';
import { fallbackOf, mountCodeCell } from './mount';

vi.setConfig({ testTimeout: 60_000 });
const LONG = { timeout: 30_000 };
const mounted: { destroy(): void; container: HTMLElement }[] = [];

function mountCell(data: Record<string, unknown>) {
  const container = document.createElement('div');
  document.body.append(container);
  const patch = vi.fn();
  const handle = mountCodeCell(container, { data, readOnly: false, patch, announce: () => undefined });
  mounted.push({ destroy: handle.destroy, container });
  return { patch, container };
}

const viewIn = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;

afterEach(() => {
  for (const one of mounted.splice(0)) {
    one.destroy();
    one.container.remove();
  }
  vi.useRealTimers();
});

const NEWER = 'This code cell needs a newer version of OpenNote';

describe('mountCodeCell forward compatibility', () => {
  it('shows a cell in an unknown language read-only, with its code, and never patches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const source = 'PROGRAM X\n';
    const { patch } = mountCell({ language: 'cobol', source });
    expect(await screen.findByText(NEWER)).toBeTruthy();
    expect(screen.getByText('Language: cobol')).toBeTruthy();
    const code = screen.getByRole('textbox', { name: 'Code' }) as HTMLTextAreaElement;
    expect(code.value).toBe(source);
    expect(code.readOnly).toBe(true);
    expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    fireEvent.change(code, { target: { value: 'edited' } });
    fireEvent.keyDown(code, { key: 'Enter', ctrlKey: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(code.value).toBe(source);
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows a cell with a minEditor above this app read-only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { patch } = mountCell({ language: 'python', source: 'print(1)\n', minEditor: 3 });
    expect(await screen.findByText(NEWER)).toBeTruthy();
    const code = screen.getByRole('textbox', { name: 'Code' }) as HTMLTextAreaElement;
    expect(code.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows what an older app shows: a TypeScript cell and a version 2 cell need a newer app', () => {
    expect(needsNewerApp({ language: 'typescript', source: 'let x: number', minEditor: 2 }, 1)).toBe(true);
    expect(needsNewerApp({ language: 'python', source: 'x', minEditor: 2, runtime: 'python-full' }, 1)).toBe(true);
    expect(needsNewerApp({ language: 'sql', source: 'select 1' }, 1)).toBe(true);
    // A version 1 cell opens in every app, and this app opens version 2.
    expect(needsNewerApp({ language: 'python', source: 'x' }, 1)).toBe(false);
    expect(needsNewerApp({ language: 'javascript', source: 'x', minEditor: 1 }, 1)).toBe(false);
    expect(needsNewerApp({ language: 'typescript', source: 'let x', minEditor: 2 })).toBe(false);
    expect(needsNewerApp({ language: 'cobol', source: 'x' })).toBe(true);
  });

  it('opens a version 1 cell and runs it unchanged', async () => {
    mountCell({ language: 'python', source: 'print(6 * 7)\n' });
    expect(screen.queryByText(NEWER)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }, LONG));
    const log = await screen.findByRole('log', { name: 'Output' }, LONG);
    await waitFor(() => expect(log.textContent).toBe('42\n'), LONG);
  });

  it('opens a version 2 TypeScript cell, editable, and runs it', async () => {
    const text = 'const a: number = 5;\nconsole.log(a * 2);\n';
    const { patch, container } = mountCell({ language: 'typescript', source: text, minEditor: 2 });
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }, LONG));
    const log = await screen.findByRole('log', { name: 'Output' }, LONG);
    await waitFor(() => expect(log.textContent).toBe('10\n'), LONG);
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull(), LONG);
    viewIn(container).dispatch({ changes: { from: 0, insert: '// t\n' } });
    const source = `// t\n${text}`;
    await waitFor(
      () =>
        expect(patch).toHaveBeenCalledWith(
          { language: 'typescript', source, minEditor: 2, runtime: null },
          fallbackOf('typescript', source),
        ),
      LONG,
    );
  });

  it('still edits and saves a Python cell with no minEditor', async () => {
    const { patch, container } = mountCell({ language: 'python', source: 'x = 1\n' });
    await screen.findByRole('textbox', { name: 'Code' }, LONG);
    expect(screen.queryByText(NEWER)).toBeNull();
    const view = viewIn(container);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'x = 2\n' } });
    await waitFor(
      () =>
        expect(patch).toHaveBeenCalledWith(
          { language: 'python', source: 'x = 2\n', minEditor: 1, runtime: null },
          fallbackOf('python', 'x = 2\n'),
        ),
      LONG,
    );
  });
});
