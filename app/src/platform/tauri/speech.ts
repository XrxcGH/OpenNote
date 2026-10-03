// Read-aloud voices through the shell (owner after WP0: WP7). Only built if spike S2 shows WebView2 lacks local
// voices; until then the platform has no speech client.
import type { SpeechClient } from '../types';
import { invoke } from './invoke';

export const SPEECH_FALLBACK_BUILT = false;

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
