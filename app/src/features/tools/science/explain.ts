// The words for a significant-figures answer: which rule was used and what limited it.
import { t } from '../../../strings/t';
import type { SigResult } from './sigfigs';

/** One sentence naming the rule that rounded the answer. Empty when the sum could not be tracked. */
export function ruleText(result: SigResult): string {
  if (!result.ok) return '';
  const count = Number.isFinite(result.limit) ? result.limit : 0;
  return t(`science.sigfigs.rules.${result.rule}`, { count });
}
