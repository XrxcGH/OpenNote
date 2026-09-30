// Performance marks in a browser: recorded in memory for tests.

import type { PerfClient, PerfMark } from '../types';
import { registerTestHook } from './testHooks';

export function createWebPerf(): PerfClient & { readonly marks: PerfMark[] } {
  const marks: PerfMark[] = [];
  registerTestHook('perfMarks', () => marks);
  return { marks, mark: (name) => void marks.push(name) };
}
