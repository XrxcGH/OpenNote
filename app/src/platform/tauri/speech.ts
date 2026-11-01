// Read-aloud voices through the shell, for macOS and Linux, where the web view lists none: `say` and `espeak-ng` make
// the sound. Windows keeps the web view's voices, so there the platform has no speech client.
import type { SpeechClient } from '../types';
import { invoke } from './invoke';

/** The shell speaks through the system's own program everywhere but Windows. */
export const SPEECH_FALLBACK_BUILT = typeof navigator !== 'undefined' && !/windows/i.test(navigator.userAgent);

export function createTauriSpeech(): SpeechClient | null {
  if (!SPEECH_FALLBACK_BUILT) return null;
  return {
    voices: () => invoke('speech_voices'),
    synthesize: async (text, voice) => {
      const buffer = await invoke('speech_synthesize', { text, voice });
      const length = new DataView(buffer).getUint32(0, true);
      const boundaries = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length))) as {
        ms: number;
        start: number;
        length: number;
      }[];
      return { wav: buffer.slice(4 + length), boundaries };
    },
  };
}
