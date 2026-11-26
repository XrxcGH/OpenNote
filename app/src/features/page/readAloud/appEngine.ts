// The read-aloud engine the app uses: the web view's local voices, or the system's where the web view has none.
import { commandContext } from '../../../commands/registry';
import { createWebSpeechEngine } from './engine';
import type { SpeechEngine } from './engine';
import { createReadAloudEngine, createSystemSpeechEngine } from './systemSpeech';

export function appSpeechEngine(): SpeechEngine | null {
  const client = commandContext('menu').platform.speech;
  return createReadAloudEngine(createWebSpeechEngine(), client ? createSystemSpeechEngine(client) : null);
}
