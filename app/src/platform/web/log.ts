// The log in a browser: recorded in memory for tests and never printed, so component tests, which fail on
// console output, stay quiet.

import type { LogLevel } from '../types';
import { registerTestHook } from './testHooks';

export function createWebLog(): {
  readonly entries: [LogLevel, string][];
  log(level: LogLevel, message: string): void;
} {
  const entries: [LogLevel, string][] = [];
  registerTestHook('log', () => entries);
  return { entries, log: (level, message) => void entries.push([level, message]) };
}
