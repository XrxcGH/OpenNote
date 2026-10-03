// Performance marks for the perf log. Rust writes them only when OPENNOTE_PERF_LOG is set.

import type { PerfClient } from '../types';
import { fire } from './invoke';

export function createTauriPerf(): PerfClient {
  return {
    mark: (name, detail) =>
      fire('perf_mark', { name, epochMs: performance.timeOrigin + performance.now(), detail: detail ?? null }),
  };
}
