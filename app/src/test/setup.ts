// Runs before every component test file (the `components` Vitest project).
// A console error or warning fails the test that caused it (ARCHITECTURE.md section 21.2), and the rendered
// tree is removed after each test.

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

let problems: string[] = [];

beforeEach(() => {
  problems = [];
  for (const level of ['error', 'warn'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      problems.push(`console.${level}: ${args.map(String).join(' ')}`);
    });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (problems.length > 0) throw new Error(problems.join('\n'));
});
