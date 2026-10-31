// A tool's result, or the sentence for what was wrong with the input.
import { errorText } from './attempt';
import type { Attempt } from './attempt';
import { OutcomeView, Problem } from './parts';
import type { Outcome } from './parts';

export function ResultView({ tool, result }: { tool: string; result: Attempt<Outcome> }) {
  return result.ok ? <OutcomeView outcome={result.value} /> : <Problem text={errorText(tool, result.code)} />;
}
