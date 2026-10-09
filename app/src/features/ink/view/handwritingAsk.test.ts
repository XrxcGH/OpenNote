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
});
