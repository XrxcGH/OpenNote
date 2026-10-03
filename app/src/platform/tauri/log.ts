// Front-end log lines go to Rust's rotating log file. Rust caps each message at 2 KB and rate-limits them.

import type { LogLevel } from '../types';
import { fire } from './invoke';

export function tauriLog(level: LogLevel, message: string): void {
  fire('log_write', { level, message });
}
