// The read-aloud engine (ARCHITECTURE.md section 19.1; ADR 0023): the Web Speech API with local voices only. Online
// voices send text to a cloud service, so they are never listed or used, even as a default. One utterance is one
// paragraph, and word boundaries drive the highlight.

export interface SpeechVoice {
  /** The voice's URI, saved in settings.editing.readAloud.voice. */
  id: string;
  name: string;
  language: string;
  isDefault: boolean;
}

export interface SpeakOptions {
  /** A voice ID, or null for the default local voice. */
  voice: string | null;
  /** From 0.5 to 2. */
  rate: number;
}

export interface SpeechEngine {
  /** The local voices, once the browser has listed them. */
  voices(): Promise<SpeechVoice[]>;
  /**
   * Speaks `text`. `onBoundary` gets each word's UTF-16 range. `onEnd` gets true when the text was spoken to its
   * end, and false when it couldn't be, such as with no local voice. Canceling calls neither.
   */
  speak(
    text: string,
    options: SpeakOptions,
    onBoundary: (start: number, length: number) => void,
    onEnd: (completed: boolean) => void,
  ): void;
  pause(): void;
  resume(): void;
  cancel(): void;
}

/** How long to wait for the browser to list its voices. */
const VOICES_WAIT_MS = 1500;

/** The length of the word at `start` when a boundary event doesn't say. */
export function wordLength(text: string, start: number): number {
  const match = /^[\p{L}\p{N}'’-]+/u.exec(text.slice(start));
  return match ? match[0].length : 0;
}

function toVoice(voice: SpeechSynthesisVoice): SpeechVoice {
  return { id: voice.voiceURI, name: voice.name, language: voice.lang, isDefault: voice.default };
}

/** The Web Speech engine over `synth`, or null where the browser has none. */
export function createWebSpeechEngine(
  synth: SpeechSynthesis | null = typeof speechSynthesis === 'undefined' ? null : speechSynthesis,
): SpeechEngine | null {
  if (!synth) return null;
  const local = () => synth.getVoices().filter((voice) => voice.localService);
  let current: SpeechSynthesisUtterance | null = null;

  const listed = (): Promise<void> =>
    synth.getVoices().length
      ? Promise.resolve()
      : new Promise((resolve) => {
          const done = () => {
            synth.removeEventListener('voiceschanged', done);
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(done, VOICES_WAIT_MS);
          synth.addEventListener('voiceschanged', done);
        });

  const choose = (id: string | null): SpeechSynthesisVoice | null => {
    const voices = local();
    return voices.find((voice) => voice.voiceURI === id) ?? voices.find((voice) => voice.default) ?? voices[0] ?? null;
  };

  return {
    async voices() {
      await listed();
      return local().map(toVoice);
    },
    speak(text, options, onBoundary, onEnd) {
      const voice = choose(options.voice);
      if (!voice) {
        onEnd(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = options.rate;
      utterance.onboundary = (event) => {
        if (current !== utterance || event.name !== 'word') return;
        onBoundary(event.charIndex, event.charLength || wordLength(text, event.charIndex));
      };
      utterance.onend = () => {
        if (current !== utterance) return;
        current = null;
        onEnd(true);
      };
      utterance.onerror = (event) => {
        if (current !== utterance || event.error === 'interrupted' || event.error === 'canceled') return;
        current = null;
        onEnd(false);
      };
      current = utterance;
      synth.speak(utterance);
    },
    pause: () => synth.pause(),
    resume: () => synth.resume(),
    cancel() {
      current = null;
      synth.cancel();
    },
  };
}
