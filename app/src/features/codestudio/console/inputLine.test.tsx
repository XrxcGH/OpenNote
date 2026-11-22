// The console's input line for a program that reads input (review gap G8): it shows while a run is going, takes
// focus when the program waits, echoes and sends a line on Enter, and ends the input with Ctrl+D or End input.
import { act, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test';
import type { RunCallbacks, RunResult } from '../run/host';
import { StudioController } from '../window/controller';
import { setStudioRunner } from '../window/runner';
import { scratchSource } from '../window/source';
import { ConsolePanel } from './ConsolePanel';

function Harness({ controller }: { controller: StudioController }) {
  useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <ConsolePanel controller={controller} />;
}

/** A runner that waits for input and records what the console sends it. */
function waitingRunner() {
  const got = { lines: [] as string[], eof: 0 };
  let callbacks: RunCallbacks | null = null;
  let finish: (result: RunResult) => void = () => {};
  setStudioRunner({
    run(_order, given) {
      callbacks = given;
      const done = new Promise<RunResult>((resolve) => (finish = resolve));
      return {
        stop: () => undefined,
        input: (text: string) => got.lines.push(text),
        eof: () => {
          got.eof += 1;
        },
        done,
      };
    },
  });
  return {
    got,
    want: (prompt: string) => act(() => callbacks!.onInputWanted?.(prompt)),
    end: () => act(() => finish({ status: 'ok', message: '', elapsedMs: 1, version: 'Test', written: [], notes: [] })),
  };
}

let controller: StudioController | null = null;
afterEach(() => controller?.dispose());

describe('the console input line', () => {
  it('waits with focus, echoes and sends a line, and ends input by key or button', async () => {
    try {
      localStorage.removeItem('opennote.codestudio.scratch');
    } catch {
      // A fresh scratch project either way.
    }
    const runner = waitingRunner();
    controller = new StudioController();
    controller.mount();
    controller.open(scratchSource());
    const studio = controller;
    renderUi(<Harness controller={studio} />);
    expect(screen.queryByRole('textbox', { name: /Input/ })).toBeNull();

    act(() => studio.run());
    runner.want('Name? ');
    expect(studio.runState).toBe('waiting');
    const field = await screen.findByRole('textbox', { name: 'Name?' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute('aria-keyshortcuts')).toBe('Control+D');

    await userEvent.keyboard('Ada{Enter}');
    expect(runner.got.lines).toEqual(['Ada']);
    expect(studio.runState).toBe('running');
    expect(screen.getByRole('log').textContent).toContain('Ada');
    expect((field as HTMLInputElement).value).toBe('');

    runner.want('');
    field.focus();
    await userEvent.keyboard('{Control>}d{/Control}');
    expect(runner.got.eof).toBe(1);

    // Touch and pen have no Ctrl+D: End input does the same.
    await userEvent.click(screen.getByRole('button', { name: 'End input' }));
    expect(runner.got.eof).toBe(2);

    runner.end();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'End input' })).toBeNull());
  });
});
