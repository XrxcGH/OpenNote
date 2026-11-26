// The code cell block in a real browser: Run shows what the code printed as text, Stop ends a run, the keyboard
// works, edits are saved with a code-fence fallback, and the cell passes axe. The code is in the studio's editor.
import { EditorView } from '@codemirror/view';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { CodeCellPanel } from './CodeCellPanel';
import type { CodeLanguage } from './model';
import { fallbackOf, mountCodeCell } from './mount';

vi.setConfig({ testTimeout: 60_000 });
const LONG = { timeout: 30_000 };

async function renderCell(source: string, language: CodeLanguage = 'python') {
  const onChange = vi.fn();
  const announce = vi.fn();
  const view = render(
    <CodeCellPanel language={language} source={source} readOnly={false} onChange={onChange} announce={announce} />,
  );
  const code = await screen.findByRole('textbox', { name: 'Code' }, LONG);
  return { ...view, onChange, announce, code };
}

/** The editor's view behind the textbox, to type into it. */
function viewOf(container: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
  if (!view) throw new Error('no editor');
  return view;
}

describe('CodeCellPanel', () => {
  it('runs Python and shows its output as text', async () => {
    const { container, announce } = await renderCell('print("<b>2 + 2</b> =", 2 + 2)');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const log = await screen.findByRole('log', { name: 'Output' }, LONG);
    await waitFor(() => expect(log.textContent).toBe('<b>2 + 2</b> = 4\n'), LONG);
    expect(log.querySelector('b')).toBeNull();
    await waitFor(() => expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Ran in /)), LONG);
    await expectNoAxeViolations(container);
  });

  it('runs JavaScript with Ctrl+Enter and shows errors', async () => {
    const { code } = await renderCell('console.log("a"); throw new RangeError("too far")', 'javascript');
    fireEvent.keyDown(code, { key: 'Enter', ctrlKey: true });
    const log = await screen.findByRole('log', { name: 'Output' }, LONG);
    await waitFor(() => expect(log.textContent).toContain('RangeError: too far'), LONG);
    // The status follows the output by a tick, which a slow runner shows.
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The cell stopped with an error.'), LONG);
  });

  it('runs a TypeScript cell', async () => {
    await renderCell('const n: number = 6;\nconsole.log(n * 7);', 'typescript');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const log = await screen.findByRole('log', { name: 'Output' }, LONG);
    await waitFor(() => expect(log.textContent).toBe('42\n'), LONG);
  });

  it('stops a run with Stop', async () => {
    await renderCell('while True:\n    pass');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const stop = await screen.findByRole('button', { name: 'Stop' }, LONG);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Running…'), LONG);
    fireEvent.click(stop);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Stopped.'), LONG);
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
  });

  it('saves the code a moment after typing, with the format version it needs', async () => {
    const { onChange, container } = await renderCell('if x:');
    viewOf(container).dispatch({ changes: { from: 5, insert: '\n    pass' } });
    await waitFor(
      () =>
        expect(onChange).toHaveBeenCalledWith({
          language: 'python',
          source: 'if x:\n    pass',
          minEditor: 1,
          runtime: null,
        }),
      LONG,
    );
  });

  it('shows the open-in-studio button only when the page provides it', async () => {
    const first = await renderCell('x = 1');
    expect(screen.queryByRole('button', { name: 'Open in Code studio' })).toBeNull();
    first.unmount();
    const open = vi.fn();
    render(
      <CodeCellPanel
        language="python"
        source="x = 1"
        readOnly={false}
        onChange={vi.fn()}
        announce={vi.fn()}
        onOpenStudio={open}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open in Code studio' }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('the code cell block', () => {
  it('saves the code with a fence as its fallback', () => {
    expect(fallbackOf('python', 'print(1)\n')).toBe('```python\nprint(1)\n```');
    expect(fallbackOf('javascript', 'const s = "```";')).toBe('````javascript\nconst s = "```";\n````');
    expect(fallbackOf('cpp', 'int x;')).toBe('```cpp\nint x;\n```');
  });

  it('mounts from block data and switches the example with the language', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const patch = vi.fn();
    const source = 'x = 1\n';
    const handle = mountCodeCell(container, {
      data: { language: 'python', source },
      readOnly: false,
      patch,
      announce: () => undefined,
    });
    const select = await screen.findByRole('combobox', { name: 'Language' });
    expect((select as HTMLSelectElement).value).toBe('python');
    fireEvent.change(select, { target: { value: 'javascript' } });
    expect(patch).toHaveBeenCalledWith(
      { language: 'javascript', source, minEditor: 1, runtime: null },
      fallbackOf('javascript', source),
    );
    fireEvent.change(select, { target: { value: 'typescript' } });
    expect(patch).toHaveBeenLastCalledWith(
      { language: 'typescript', source, minEditor: 2, runtime: null },
      fallbackOf('typescript', source),
    );
    handle.destroy();
    container.remove();
  });
});
