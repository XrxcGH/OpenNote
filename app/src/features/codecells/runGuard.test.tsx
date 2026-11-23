// Two quick Ctrl+Enter presses start one run, not two: the second press lands while the run chunk still loads.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CodeCellPanel } from './CodeCellPanel';

vi.setConfig({ testTimeout: 60_000 });
const LONG = { timeout: 30_000 };
const started = vi.hoisted(() => ({ count: 0 }));

vi.mock('./run', async (importOriginal) => {
  const real = await importOriginal<typeof import('./run')>();
  return {
    ...real,
    runCode: (...args: Parameters<typeof real.runCode>) => {
      started.count += 1;
      return real.runCode(...args);
    },
  };
});

describe('CodeCellPanel run guard', () => {
  it('starts one run for two quick Ctrl+Enter presses', async () => {
    render(
      <CodeCellPanel
        language="javascript"
        source="console.log(1)"
        readOnly={false}
        onChange={vi.fn()}
        announce={vi.fn()}
      />,
    );
    const code = await screen.findByRole('textbox', { name: 'Code' }, LONG);
    fireEvent.keyDown(code, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(code, { key: 'Enter', ctrlKey: true });
    const log = await screen.findByRole('log', { name: 'Output' }, LONG);
    await waitFor(() => expect(log.textContent).toBe('1\n'), LONG);
    expect(started.count).toBe(1);
  });
});
