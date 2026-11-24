// A run that fails because its runtime or download is missing says what to do, and never claims the cell printed
// nothing. The run core is replaced here, so the failure is exact.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, settingsStore } from '../../state/settings';
import { codeStudioCpp } from '../../strings/en/codeStudio/cpp';
import { codeStudioPython } from '../../strings/en/codeStudio/python';
import { CodeCellPanel } from './CodeCellPanel';

const failure = vi.hoisted(() => ({ message: '', status: 'failed', timeMs: 0 }));
vi.mock('./run', () => ({
  runCode: (_language: string, _source: string, _out: unknown, limits: { timeMs: number }) => {
    failure.timeMs = limits.timeMs;
    return {
      stop: () => undefined,
      done: Promise.resolve({ status: failure.status, message: failure.message, elapsedMs: 0, truncated: false }),
    };
  },
}));

async function runFailing(message: string, language: 'python' | 'c' = 'python') {
  failure.message = message;
  failure.status = 'failed';
  render(
    <CodeCellPanel
      language={language}
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

  it('names the missing C and C++ download, as the studio does (walk fix T4-C05-1)', async () => {
    await runFailing('pack-missing', 'c');
    expect(screen.getByRole('status').textContent).toBe(codeStudioCpp.packMissing);
  });

  it('runs and words the time limit from Settings, Code (walk fix T4-C05-2)', async () => {
    const before = settingsStore.get();
    settingsStore.set({
      ...before,
      settings: { ...before.settings, code: { ...DEFAULT_SETTINGS.code, timeLimitSeconds: 2 } },
    });
    try {
      await runFailing('', 'python');
      expect(failure.timeMs).toBe(2000);
      expect(screen.getByText(/for up to 2 seconds/)).toBeTruthy();
    } finally {
      settingsStore.set(before);
    }
  });
});
