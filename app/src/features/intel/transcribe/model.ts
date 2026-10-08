// Which downloaded speech model a job uses: the one the person chose, if it is on this device, or else the first
// installed one in the order OpenNote recommends. Null when none is installed.
import type { ModelList } from '../../../services/intel';

/** The speech models in the order they are tried, the recommended one first. */
export const SPEECH_PREFERENCE = [
  'speech-base-en',
  'speech-small-en',
  'speech-tiny-en',
  'speech-base',
  'speech-small',
] as const;

export function pickSpeechModel(list: ModelList | null, chosen: string | null): string | null {
  const installed = new Set(
    (list?.models ?? []).filter((one) => one.kind === 'speech' && one.state === 'installed').map((one) => one.id),
  );
  if (chosen && installed.has(chosen)) return chosen;
  return SPEECH_PREFERENCE.find((id) => installed.has(id)) ?? [...installed][0] ?? null;
}
