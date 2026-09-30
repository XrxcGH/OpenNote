// Performance marks in a browser: recorded in memory for tests.

import type { PerfClient, PerfMark } from '../types';
import { registerTestHook } from './testHooks';

export function createWebPerf(): PerfClient & { readonly marks: PerfMark[]; readonly details: Map<PerfMark, string> } {
  const marks: PerfMark[] = [];
  const details = new Map<PerfMark, string>();
  registerTestHook('perfMarks', () => marks);
  registerTestHook('perfDetails', () => Object.fromEntries(details));
  return {
    marks,
    details,
    mark: (name, detail) => {
      marks.push(name);
      if (detail !== undefined) details.set(name, detail);
    },
  };
}
