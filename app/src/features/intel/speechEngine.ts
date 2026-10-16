// The read-aloud engine over the on-device crate (Phase 12): the voices installed on Windows, with the time of every
// word. It has the same shape as the page's SpeechEngine, so the page's reader, bar, and highlight work unchanged.
// A page is read chunk by chunk: the next chunk is made while the current one plays, and the Rust side holds no more
// than a few. Everything runs on this device.
import { pageSpan, wordAt } from '../../services/intel';
import type { IntelClient, ReadAloudChunk, Voice } from '../../services/intel';
import { intelClient } from './runtime';

/** The shape of the page's voice entry, so the page's voice list shows these voices as it does any others. */
export interface OnDeviceVoice {
  id: string;
  name: string;
  language: string;
  isDefault: boolean;
}

/** The page's SpeechEngine, which this engine matches member for member. */
export interface OnDeviceSpeech {
  voices(): Promise<OnDeviceVoice[]>;
  speak(
    text: string,
    options: { voice: string | null; rate: number },
    onBoundary: (start: number, length: number) => void,
    onEnd: (completed: boolean) => void,
  ): void;
  pause(): void;
  resume(): void;
  cancel(): void;
}

/** What plays a clip. The browser's audio element is the default, and tests give their own. */
export interface ClipPlayer {
  /** Resolves when the clip ends, or when `stop` is called. Rejects when it can't play. */
  play(wav: Uint8Array, onTime: (ms: number) => void): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

export function createAudioPlayer(): ClipPlayer {
  let audio: HTMLAudioElement | null = null;
  let release: (() => void) | null = null;
  const done = () => {
    release?.();
    release = null;
  };
  return {
    play(wav, onTime) {
      const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }));
      const element = new Audio(url);
      audio = element;
      let frame = 0;
      const tick = () => {
        onTime(element.currentTime * 1000);
        frame = requestAnimationFrame(tick);
      };
      return new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => {
          cancelAnimationFrame(frame);
          element.pause();
          URL.revokeObjectURL(url);
          if (audio === element) audio = null;
          release = null;
          if (error) reject(error instanceof Error ? error : new Error('The clip could not be played.'));
          else resolve();
        };
        release = () => finish();
        element.addEventListener('ended', () => finish());
        element.addEventListener('error', () => finish(new Error('The clip could not be played.')));
        element.play().then(
          () => {
            frame = requestAnimationFrame(tick);
          },
          (error: unknown) => finish(error ?? new Error('The clip could not be played.')),
        );
      });
    },
    pause: () => {
      audio?.pause();
    },
    resume: () => {
      void audio?.play().catch(() => undefined);
    },
    stop: done,
  };
}

export interface OnDeviceSpeechOptions {
  client?: () => Promise<IntelClient>;
  player?: () => ClipPlayer;
}

const NOTHING = (): void => undefined;

type Boundary = (start: number, length: number) => void;

class OnDeviceSpeechEngine implements OnDeviceSpeech {
  private known: Voice[] | null = null;
  /** Counts starts and cancels, so a read that was replaced or canceled stops where it is. */
  private run = 0;
  private stopCurrent: () => void = NOTHING;
  private player: ClipPlayer | null = null;

  constructor(
    private readonly client: () => Promise<IntelClient>,
    private readonly newPlayer: () => ClipPlayer,
  ) {}

  private async listVoices(): Promise<Voice[]> {
    this.known ??= await (await this.client()).voices();
    return this.known;
  }

  async voices(): Promise<OnDeviceVoice[]> {
    try {
      return (await this.listVoices()).map((voice, index) => ({
        id: voice.id,
        name: voice.name,
        language: voice.language,
        isDefault: index === 0,
      }));
    } catch {
      return [];
    }
  }

  speak: OnDeviceSpeech['speak'] = (text, options, onBoundary, onEnd) => {
    this.cancel();
    const mine = ++this.run;
    this.readChunks(mine, text, options, onBoundary).then(
      () => {
        if (this.run === mine) onEnd(true);
      },
      () => {
        if (this.run === mine) onEnd(false);
      },
    );
  };

  pause = (): void => this.player?.pause();
  resume = (): void => this.player?.resume();

  cancel = (): void => {
    this.run += 1;
    this.stopCurrent();
    this.stopCurrent = NOTHING;
    this.player?.stop();
    this.player = null;
  };

  /** The voice to ask for: the one named when this computer has it, else the default. */
  private async chooseVoice(voice: string | null): Promise<string | null> {
    return voice && (await this.listVoices()).some((one) => one.id === voice) ? voice : null;
  }

  private async readChunks(
    mine: number,
    text: string,
    options: { voice: string | null; rate: number },
    onBoundary: Boundary,
  ): Promise<void> {
    const voice = await this.chooseVoice(options.voice);
    const session = await (await this.client()).readAloud(text, { voice, rate: options.rate });
    if (this.run !== mine) {
      await session.cancel();
      return;
    }
    this.stopCurrent = () => void session.cancel();
    const chunks = session[Symbol.asyncIterator]();
    let pending = chunks.next();
    try {
      for (;;) {
        const result = await pending;
        if (result.done || this.run !== mine) return;
        // Make the next chunk while this one plays.
        pending = chunks.next();
        pending.catch(NOTHING);
        await this.play(mine, result.value, onBoundary);
      }
    } finally {
      pending.catch(NOTHING);
      await session.cancel();
    }
  }

  private async play(mine: number, chunk: ReadAloudChunk, onBoundary: Boundary): Promise<void> {
    const wav = await chunk.audio();
    if (this.run !== mine) return;
    this.player = this.newPlayer();
    let last = -1;
    await this.player.play(wav, (ms) => {
      const word = this.run === mine ? wordAt(chunk.info, ms) : null;
      if (!word) return;
      const span = pageSpan(chunk, word);
      if (span.start === last) return;
      last = span.start;
      onBoundary(span.start, span.end - span.start);
    });
  }
}

export function createOnDeviceSpeech(options: OnDeviceSpeechOptions = {}): OnDeviceSpeech {
  return new OnDeviceSpeechEngine(options.client ?? intelClient, options.player ?? createAudioPlayer);
}
