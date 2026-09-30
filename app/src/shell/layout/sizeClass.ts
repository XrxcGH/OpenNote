// Size classes (ARCHITECTURE.md section 11.1). Each breakpoint token is the lower edge of its class, in CSS
// pixels, so the in-app zoom moves the breakpoints as in a browser: a 1,440 px window at 200% is medium.

import { tokens } from '../../theme/tokens';

export type SizeClass = 'compact' | 'medium' | 'expanded' | 'wide';

/** The size class for a width in CSS pixels. */
export function sizeClassFor(width: number): SizeClass {
  const { medium, expanded, wide } = tokens.breakpoint;
  if (width >= wide) return 'wide';
  if (width >= expanded) return 'expanded';
  if (width >= medium) return 'medium';
  return 'compact';
}

/** The three min-width media queries that mark the edges between the classes. */
export function breakpointQueries(): string[] {
  const { medium, expanded, wide } = tokens.breakpoint;
  return [medium, expanded, wide].map((edge) => `(min-width: ${edge}px)`);
}
