// Read aloud with the voices the operating system has, for where the web view lists none (macOS and Linux). The shell
// makes a WAV and the position of each word (`speech_synthesize`); this plays it and reports each word as its time
// comes. Text stays on the computer: the shell speaks it through `say` or `espeak-ng`.

import type { SpeechClient } from '../../../platform/types';
import type { SpeechEngine, SpeechVoice } from './engine';

/** The part of an audio element this engine uses, so a test can stand in for it. */
export interface Playback {
  playbackRate: number;
  readonly currentTime: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
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
): SpeechEngine {
  let turn = 0;
  let stop: () => void = () => undefined;
  let current: Playback | null = null;

  return {
    async voices() {
      const list = await client.voices().catch(() => []);
      return list.map((voice, index): SpeechVoice => ({ ...voice, isDefault: index === 0 }));
    },
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
      client
        .synthesize(text, options.voice ?? '')
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
    voices: decide,
    speak(text, options, onBoundary, onEnd) {
      void decide().then(() => chosen.speak(text, options, onBoundary, onEnd));
    },
    pause: () => chosen.pause(),
    resume: () => chosen.resume(),
    cancel: () => {
      web.cancel();
      system.cancel();
    },
  };
}
