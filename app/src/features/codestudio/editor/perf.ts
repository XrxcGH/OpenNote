// The typing benchmark hook for lane code:L20 (DESIGN 15: key to screen at most 16 ms in a 1,000-line file). It
// types characters one transaction at a time and times each, including the synchronous DOM update.

import type { EditorView } from '@codemirror/view';

export interface TypingTimes {
  median: number;
  p95: number;
  max: number;
}

/** Types `count` characters at the caret and returns the time per key in milliseconds. */
export function measureTyping(view: EditorView, count = 200, text = 'x'): TypingTimes {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const started = performance.now();
    view.dispatch(view.state.replaceSelection(text[i % text.length] ?? 'x'), { userEvent: 'input.type' });
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
  return { median: at(0.5), p95: at(0.95), max: times[times.length - 1] ?? 0 };
}
