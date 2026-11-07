// @vitest-environment jsdom
// The typing budget hook for lane code:L20 (DESIGN 15): in a 1,000-line Python file, each key press, from the
// transaction to the updated DOM, stays under 16 ms (one frame at 60 Hz). The median is the gate, so one slow key
// on a loaded machine does not fail it; L20 runs the real-browser benchmark nightly.
import { afterEach, describe, expect, it } from 'vitest';
import { measureTyping } from './perf';
import { mount, unmountAll } from './testEditor';

afterEach(unmountAll);

const FILE = Array.from({ length: 1000 }, (_, i) =>
  i % 5 === 0 ? `def f${i}(x):` : `    total_${i} = x * ${i} + len("line ${i}")`,
).join('\n');

describe('typing in a 1,000-line file', () => {
  it('stays under 16 ms a key', async () => {
    const editor = await mount({ language: 'python', text: FILE, caret: FILE.length / 2 });
    expect(editor.view.state.doc.lines).toBe(1000);
    const times = measureTyping(editor.view, 200, 'abc ');
    expect(times.median).toBeLessThan(16);
  });
});
