// A query's table as console text (walk fix T3-C04-9), and the studio console showing it.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { setStudioRunner } from '../window/runner';
import type { Runner } from '../window/runner';
import { StudioController } from '../window/controller';
import { scratchSource } from '../window/source';
import { tableText } from './tableText';

const MIME = 'application/vnd.opennote.table+json';

describe('tableText', () => {
  it('aligns columns under a header', () => {
    const text = tableText(
      MIME,
      JSON.stringify({
        columns: ['total', 'name'],
        rows: [
          [5, 'ab'],
          [12, null],
        ],
      }),
    );
    expect(text).toBe('total  name\n-----  ----\n5      ab\n12     NULL\n');
  });

  it('ignores other kinds and bad data', () => {
    expect(tableText('image/png', '{}')).toBe('');
    expect(tableText(MIME, 'not json')).toBe('');
    expect(tableText(MIME, JSON.stringify({ columns: ['id', 'parent', 'notused', 'detail'], rows: [] }))).toBe('');
  });
});

describe('studio console', () => {
  it('shows the rows of a rich table', async () => {
    const runner: Runner = {
      run: (_order, callbacks) => ({
        stop: () => undefined,
        input: () => undefined,
        eof: () => undefined,
        done: Promise.resolve().then(() => {
          callbacks.onRich?.(MIME, JSON.stringify({ columns: ['total'], rows: [[5]] }));
          callbacks.onOutput?.('out', '1 row.\n');
          return { status: 'ok', message: '', elapsedMs: 1, written: [], notes: [] } as never;
        }),
      }),
    };
    setStudioRunner(runner);
    localStorage.removeItem('opennote.codestudio.scratch');
    const controller = new StudioController();
    const unmount = controller.mount();
    controller.open(scratchSource());
    controller.run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(controller.console.text()).toContain('total');
    expect(controller.console.text()).toContain('5');
    unmount();
    setStudioRunner(null);
  });
});
