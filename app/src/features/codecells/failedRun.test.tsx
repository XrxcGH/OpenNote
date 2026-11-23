// A run that fails because its runtime or download is missing says what to do, and never claims the cell printed
// nothing. The run core is replaced here, so the failure is exact.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { codeStudioPython } from '../../strings/en/codeStudio/python';
import { CodeCellPanel } from './CodeCellPanel';

const failure = vi.hoisted(() => ({ message: '' }));
vi.mock('./run', () => ({
  runCode: () => ({
    stop: () => undefined,
    done: Promise.resolve({ status: 'failed', message: failure.message, elapsedMs: 0, truncated: false }),
  }),
}));

async function runFailing(message: string) {
  failure.message = message;
  render(
    <CodeCellPanel
      language="python"
      engine="python-full"
      source="print(1)"
      readOnly={false}
      onChange={vi.fn()}
      announce={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(''), { timeout: 30_000 });
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toMatch(/^Running|^Starting/));
}

describe('a failed run', () => {
  it('names the missing Python download and prints no empty-output line', async () => {
    await runFailing(codeStudioPython.fullMissing);
    expect(screen.getByRole('status').textContent).toBe(
      'This language needs a download first. Open Settings, then Code, then Downloads.',
    );
    expect(screen.queryByRole('log')).toBeNull();
  });

  it('says a language is not in this version, with no empty-output line', async () => {
    await runFailing('runtime');
    expect(screen.getByRole('status').textContent).toBe('This language cannot run in this version of OpenNote yet.');
    expect(screen.queryByRole('log')).toBeNull();
  });
});
