// Ghost text without a model (DESIGN 10.2, 5.3.1). Automatic: the pattern predictor at its normal threshold.
// Explicit (Ctrl+Tab with nothing showing, or Alt+\): the predictor at its lower threshold first. Then the list's
// top item, when the caret ends a word and that item leads the next by the fixed margin. Nothing below that.

import type { CompletionContext, GhostSuggestion, ProjectLanguage } from '../contracts';
import { predict } from './pattern';
import { leader } from './rank';
import type { RankInput } from './rank';
import { wordBefore } from './tokens';

export interface GhostQuery {
  language: string;
  text: string;
  pos: number;
  explicit: boolean;
}

/** The completion context for a caret, as the list would see it after an explicit request. */
export function contextAt(language: string, text: string, pos: number, file = ''): CompletionContext {
  return { language: language as ProjectLanguage, file, text, pos, word: wordBefore(text, pos), explicit: true };
}

/** One suggestion for the caret, or null. */
export function suggest(query: GhostQuery, input: RankInput = {}): GhostSuggestion | null {
  const { language, text, pos, explicit } = query;
  const predicted = predict(language, text, pos, explicit);
  if (predicted) return { from: pos, text: predicted.text, origin: 'pattern', confidence: predicted.confidence };
  if (!explicit) return null;
  const rest = leader(contextAt(language, text, pos), input);
  return rest ? { from: pos, text: rest, origin: 'pattern', confidence: 0.5 } : null;
}
