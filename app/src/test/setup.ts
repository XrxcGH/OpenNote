// Runs before every component test file (the `components` Vitest project).
// A console error or warning fails the test that caused it (ARCHITECTURE.md section 21.2). After each test the
// rendered tree goes, and renderApp's listeners and every store reset.

// The app's own style sheets, in the order main.tsx loads them, so sizes, colors, and focus rings are real.
import '../styles/layers.css';
import '../theme/fonts';
import '../theme/tokens.css';
import '../styles/base.css';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { disposeApp } from './render';

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
  disposeApp();
  vi.restoreAllMocks();
  if (problems.length > 0) throw new Error(problems.join('\n'));
});
