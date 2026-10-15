// T2-14: the question to turn handwriting reading on is asked when the writing pen is chosen, once, never from a stroke.
import { describe, expect, it, vi } from 'vitest';
import { createWritingPen } from './handwriting';
import type { InkHost } from './host';
import { chooseTool } from './state';

describe('the writing pen and the turn-on question', () => {
  it('asks once when chosen, not again for other tools, and stops listening when destroyed', () => {
    const ensure = vi.fn(() => Promise.resolve(false));
    const host = { handwriting: { recognize: vi.fn(), tidy: vi.fn(), ensure } } as unknown as InkHost;
    chooseTool('pen');
    const pen = createWritingPen(host, () => null);
    chooseTool('writing');
    expect(ensure).toHaveBeenCalledTimes(1);
    chooseTool('writing');
    chooseTool('eraser');
    expect(ensure).toHaveBeenCalledTimes(1);
    chooseTool('writing');
    expect(ensure).toHaveBeenCalledTimes(2);
    pen.destroy();
    chooseTool('pen');
    chooseTool('writing');
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('asks at once when the writing pen is already active, and shares one answer with the first stroke', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    const ensure = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const host = { handwriting: { recognize: vi.fn(), tidy: vi.fn(), ensure } } as unknown as InkHost;
    chooseTool('writing');
    const pen = createWritingPen(host, () => null);
    expect(ensure).toHaveBeenCalledTimes(1);
    pen.note([{ id: 's1' }] as never);
    expect(ensure).toHaveBeenCalledTimes(1);
    answer(false);
    await Promise.resolve();
    pen.note([{ id: 's2' }] as never);
    expect(ensure).toHaveBeenCalledTimes(1);
    pen.destroy();
  });
});
