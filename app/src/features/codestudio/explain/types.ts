// Shapes of the explanation catalog (DESIGN 7.2). An entry names the error, the pattern that finds it in the runtime's
// message, and real messages the pattern must match. The words live in strings/en/codeStudio/explain.ts under the id.

import type { codeStudioExplain } from '../../../strings/en/codeStudio/explain';

export type EntryId = keyof typeof codeStudioExplain.entries;

export type ExplainLanguage = 'python' | 'javascript' | 'typescript' | 'c' | 'cpp' | 'sql' | 'lua';

export interface CatalogEntry {
  id: EntryId;
  /** Tested against the cleaned message. Named groups become the values the words use, such as `{name}`. */
  pattern: RegExp;
  /** Messages the runtime or compiler really prints for this error. Each one must match this entry first. */
  samples: readonly string[];
}

export const entry = (id: EntryId, pattern: RegExp, samples: readonly string[]): CatalogEntry => ({
  id,
  pattern,
  samples,
});

/** One pattern for two spellings of a message. The second spelling names its groups `name2`, `what2`. */
export const either = (a: RegExp, b: RegExp): RegExp => new RegExp('(?:' + a.source + ')|(?:' + b.source + ')');
