// The web platform's read-aloud voices (owner after WP0: WP7). Read aloud uses the browser's Web Speech voices, so
// the fallback client exists only if spike S2 shows WebView2 lacks them. Until then there is none.
import type { SpeechClient } from '../types';

export function createWebSpeech(): SpeechClient | null {
  return null;
}
