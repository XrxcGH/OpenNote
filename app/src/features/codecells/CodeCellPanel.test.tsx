// The code cell block in a real browser: Run shows what the code printed as text, Stop ends a run, the keyboard
// works, edits are saved with a code-fence fallback, and the cell passes axe.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { CodeCellPanel } from './CodeCellPanel';
import { fallbackOf, mountCodeCell } from './mount';

vi.setConfig({ testTimeout: 60_000 });
const LONG = { timeout: 30_000 };

function renderCell(source: string, language: 'python' | 'javascript' = 'python') {
  const onChange = vi.fn();
  const announce = vi.fn();
  const view = render(
    <CodeCellPanel language={language} source={source} readOnly={false} onChange={onChange} announce={announce} />,
  );
  return { ...view, onChange, announce };
}

describe('CodeCellPanel', () => {
  it('runs Python and shows its output as text', async () => {
    const { container, announce } = renderCell('print("<b>2 + 2</b> =", 2 + 2)');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const log = await screen.findByRole('log', { name: 'Output' }, LONG);
    await waitFor(() => expect(log.textContent).toBe('<b>2 + 2</b> = 4\n'), LONG);
    expect(log.querySelector('b')).toBeNull();
    await waitFor(() => expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Ran in /)), LONG);
    await expectNoAxeViolations(container);
  });

  it('runs JavaScript with Ctrl+Enter and shows errors', async () => {
    renderCell('console.log("a"); throw new RangeError("too far")', 'javascript');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Code' }), { key: 'Enter', ctrlKey: true });
    const log = await screen.findByRole('log', { name: 'Output' }, LONG);
    await waitFor(() => expect(log.textContent).toContain('RangeError: too far'), LONG);
    expect(screen.getByRole('status').textContent).toBe('The cell stopped with an error.');
  });

  it('stops a run with Stop', async () => {
    renderCell('while True:\n    pass');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const stop = await screen.findByRole('button', { name: 'Stop' }, LONG);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Running…'), LONG);
    fireEvent.click(stop);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Stopped.'), LONG);
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
  });

  it('indents with Tab and saves the code', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { onChange } = renderCell('if x:');
      const code = screen.getByRole('textbox', { name: 'Code' }) as HTMLTextAreaElement;
      code.setSelectionRange(5, 5);
      fireEvent.keyDown(code, { key: 'Tab' });
      expect(code.value).toBe('if x:    ');
      // Escape, then Tab, leaves the box as usual.
      fireEvent.keyDown(code, { key: 'Escape' });
      expect(fireEvent.keyDown(code, { key: 'Tab' })).toBe(true);
      act(() => vi.advanceTimersByTime(500));
      expect(onChange).toHaveBeenCalledWith({ language: 'python', source: 'if x:    ' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the code cell block', () => {
  it('saves the code with a fence as its fallback', () => {
    expect(fallbackOf('python', 'print(1)\n')).toBe('```python\nprint(1)\n```');
    expect(fallbackOf('javascript', 'const s = "```";')).toBe('````javascript\nconst s = "```";\n````');
  });

  it('mounts from block data and switches the example with the language', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const patch = vi.fn();
    const source = 'x = 1\n';
    const handle = mountCodeCell(container, {
      data: { language: 'nope', source },
      readOnly: false,
      patch,
      announce: () => undefined,
    });
    const select = await screen.findByRole('combobox', { name: 'Language' });
    expect((select as HTMLSelectElement).value).toBe('python');
    fireEvent.change(select, { target: { value: 'javascript' } });
    expect(patch).toHaveBeenCalledWith({ language: 'javascript', source }, fallbackOf('javascript', source));
    handle.destroy();
    container.remove();
  });
});
