// Read aloud with the voices the operating system has, for where the web view lists none (macOS and Linux). The shell
// makes a WAV and the position of each word (`speech_synthesize`); this plays it and reports each word as its time
// comes. Text stays on the computer: the shell speaks it through `say` or `espeak-ng`.

import type { SpeechClient } from '../../../platform/types';
import { voiceLanguage } from '../../../state/language';
import { pickVoice, type SpeechEngine, type SpeechVoice } from './engine';

/** The part of an audio element this engine uses, so a test can stand in for it. */
export interface Playback {
  playbackRate: number;
  readonly currentTime: number;
  onended: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event | string) => unknown) | null;
  play(): Promise<void> | void;
  pause(): void;
}

export interface PlaybackSource {
  start(wav: ArrayBuffer): Playback;
  release(): void;
}

/** Plays through an audio element on a Blob URL. */
export function browserPlayback(): PlaybackSource {
  let url: string | null = null;
  return {
    start(wav) {
      url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      return new Audio(url);
    },
    release() {
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
  };
}

type Frame = (run: () => void) => number;

export function createSystemSpeechEngine(
  client: SpeechClient,
  makePlayback: () => PlaybackSource = browserPlayback,
  frame: Frame = (run) => requestAnimationFrame(run),
  language: () => string = voiceLanguage,
): SpeechEngine {
  let turn = 0;
  let stop: () => void = () => undefined;
  let current: Playback | null = null;
  let known: SpeechVoice[] | null = null;

  // The default is the voice for the interface language, the same rule the web engine uses, and it is the voice
  // that is spoken when none is saved or the saved one is not installed here.
  const listed = async (): Promise<SpeechVoice[]> => {
    const list = await client.voices().catch(() => []);
    const best = pickVoice(
      list.map((voice) => ({ voiceURI: voice.id, lang: voice.language, default: false })),
      null,
      language(),
    );
    known = list.map((voice): SpeechVoice => ({ ...voice, isDefault: voice.id === best?.voiceURI }));
    return known;
  };
  const voiceFor = (list: readonly SpeechVoice[], saved: string | null): string =>
    list.find((voice) => voice.id === saved)?.id ?? list.find((voice) => voice.isDefault)?.id ?? '';

  return {
    voices: listed,
    speak(text, options, onBoundary, onEnd) {
      stop();
      const mine = ++turn;
      const source = makePlayback();
      let live = true;
      stop = () => {
        live = false;
        current?.pause();
        current = null;
        source.release();
      };
      (known ? Promise.resolve(known) : listed())
        .then((list) => client.synthesize(text, voiceFor(list, options.voice)))
        .then(({ wav, boundaries }) => {
          if (mine !== turn) return;
          const audio = source.start(wav);
          current = audio;
          audio.playbackRate = options.rate;
          let next = 0;
          const follow = () => {
            if (!live || mine !== turn) return;
            const now = audio.currentTime * 1000;
            while (next < boundaries.length && boundaries[next].ms <= now) {
              const { start, length } = boundaries[next++];
              onBoundary(start, length);
            }
            frame(follow);
          };
          audio.onended = () => {
            if (mine !== turn) return;
            stop();
            onEnd(true);
          };
          audio.onerror = () => {
            if (mine !== turn) return;
            stop();
            onEnd(false);
          };
          void Promise.resolve(audio.play()).catch(() => {
            if (mine !== turn) return;
            stop();
            onEnd(false);
          });
          frame(follow);
        })
        .catch(() => {
          if (mine !== turn) return;
          stop();
          onEnd(false);
        });
    },
    pause: () => current?.pause(),
    resume: () => void current?.play(),
    cancel() {
      turn += 1;
      stop();
    },
  };
}

/**
 * The web view's engine when it has local voices, and the system engine when it has none. The choice is made the
 * first time voices are listed, and again on each listing, so installing a voice takes effect on the next open.
 */
export function createReadAloudEngine(web: SpeechEngine | null, system: SpeechEngine | null): SpeechEngine | null {
  if (!system) return web;
  if (!web) return system;
  let chosen: SpeechEngine = web;
  // Each speak or cancel starts a new turn, so a speak that was waiting on the choice does nothing once the
  // person pressed Stop or asked for something else. The choice is made once and refreshed on each listing.
  let turn = 0;
  let started = false;
  let pausedEarly = false;
  let decided: Promise<SpeechVoice[]> | null = null;
  const decide = async (): Promise<SpeechVoice[]> => {
    const webVoices = await web.voices();
    if (webVoices.length > 0) {
      chosen = web;
      return webVoices;
    }
    const systemVoices = await system.voices();
    chosen = systemVoices.length > 0 ? system : web;
    return systemVoices;
  };
  return {
    voices: () => {
      decided = decide();
      return decided;
    },
    speak(text, options, onBoundary, onEnd) {
      const mine = ++turn;
      started = false;
      pausedEarly = false;
      decided ??= decide();
      void decided.then(() => {
        if (mine !== turn) return;
        started = true;
        chosen.speak(text, options, onBoundary, onEnd);
        if (pausedEarly) chosen.pause();
      });
    },
    pause() {
      if (started) chosen.pause();
      else pausedEarly = true;
    },
    resume() {
      if (started) chosen.resume();
      else pausedEarly = false;
    },
    cancel: () => {
      turn += 1;
      started = false;
      pausedEarly = false;
      web.cancel();
      system.cancel();
    },
  };
}
