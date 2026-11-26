// Completion (DESIGN 10). Lane code:L12 writes the sources and the pattern predictor without a model; lanes
// code:L13a and code:L13b add model suggestions. Enter or Ctrl+Tab accepts; Tab always indents.

import type { ProjectLanguage } from './project';

/** Where a candidate came from. The source's prior weight enters the score (DESIGN 10.2). */
export type CompletionSourceId = 'scope' | 'members' | 'keywords' | 'snippets' | 'words' | 'recency' | 'model';

export type CompletionKind =
  'variable' | 'function' | 'method' | 'property' | 'class' | 'module' | 'keyword' | 'snippet' | 'text';

/** What a source reads: the file, the caret, and the word before it. */
export interface CompletionContext {
  language: ProjectLanguage;
  /** The project path. */
  file: string;
  text: string;
  /** The caret offset. */
  pos: number;
  /** The word that ends at the caret; empty at a `.` or a space. */
  word: { from: number; to: number; text: string };
  /** True when the person asked (Ctrl+Space), not just typed. */
  explicit: boolean;
}

/** One candidate in the list. Scores are deterministic, and ties sort alphabetically. */
export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  source: CompletionSourceId;
  score: number;
  /** A short note shown beside the label, such as a signature. */
  detail?: string;
  /** The text to insert, when it differs from the label. A snippet uses `${1:name}` fields. */
  insert?: string;
  snippet?: boolean;
}

/** One source of candidates. */
export interface CompletionSource {
  id: CompletionSourceId;
  /** The source's prior weight (DESIGN 10.2). */
  prior: number;
  complete(context: CompletionContext): CompletionItem[] | Promise<CompletionItem[]>;
}

/**
 * Ghost text: a gray continuation inserted at `from` when accepted. Shown only above the source's confidence
 * threshold, so a guess is never random. A model suggestion carries the request ID it answers.
 */
export interface GhostSuggestion {
  from: number;
  text: string;
  origin: 'pattern' | 'model';
  /** From 0 to 1. */
  confidence: number;
  requestId?: string;
}
