// What the downloaded models change (A3-23). A language model puts the language engines behind Ask and the writing
// tools. The meaning model replaces the built-in embedder. Removing either puts the rule-based engines back. This runs
// each time the model list is read, and it does nothing until a model is on this computer, so a person who downloaded
// nothing sees no difference at all.
import type { IntelExt, ModelList } from '../../../services/intel';
import { syncLanguageEngines } from './llm';

let last = '';

/** Follows the models in `list`. Skipped when no model changed since the last call. */
export async function followModels(ext: IntelExt, list: ModelList): Promise<void> {
  const key = list.models
    .filter((one) => one.state === 'installed' && (one.kind === 'language' || one.kind === 'meaning'))
    .map((one) => one.id)
    .join(',');
  if (key === last) return;
  last = key;
  await syncLanguageEngines(ext, list);
  const { syncEmbedderFrom } = await import('../meaning/engine');
  await syncEmbedderFrom(list, async () => (await ext.engines.info()).onnx);
}

/** Tests start over. */
export function resetFollowForTests(): void {
  last = '';
}
