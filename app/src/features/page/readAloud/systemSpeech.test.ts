// The system voices for read aloud: words reported as the audio reaches them, the end, errors, cancel, and the choice
// between the web view's voices and the system's.
import { describe, expect, it, vi } from 'vitest';
import type { SpeechClient } from '../../../platform/types';
import type { SpeechEngine } from './engine';
import { createReadAloudEngine, createSystemSpeechEngine } from './systemSpeech';
import type { Playback } from './systemSpeech';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  boundaries = [
    { ms: 0, start: 0, length: 3 },
    { ms: 500, start: 4, length: 3 },
  ],
) {
  const audio: Playback & { time: number } = {
    playbackRate: 1,
    time: 0,
    get currentTime() {
      return this.time;
    },
    onended: null,
    onerror: null,
    play: vi.fn(() => undefined),
    pause: vi.fn(),
  };
  const frames: (() => void)[] = [];
  const client: SpeechClient = {
    voices: vi.fn(() => Promise.resolve([{ id: 'Alex', name: 'Alex', language: 'en-US' }])),
    synthesize: vi.fn(() => Promise.resolve({ wav: new ArrayBuffer(8), boundaries })),
  };
  const release = vi.fn();
  const engine = createSystemSpeechEngine(
    client,
    () => ({ start: () => audio, release }),
    (run) => frames.push(run),
    () => 'en-US',
  );
  const tick = () => frames.splice(0).forEach((run) => run());
  return { audio, client, engine, release, tick };
}

const noop = () => undefined;

describe('the system speech engine', () => {
  it('speaks the default voice, the one the picker marks, when the saved voice is not installed', async () => {
    const { client, engine } = setup();
    vi.mocked(client.voices).mockResolvedValue([
      { id: 'Albert', name: 'Albert', language: 'af-ZA' },
      { id: 'Alex', name: 'Alex', language: 'en-US' },
    ]);
    expect((await engine.voices()).map((voice) => voice.isDefault)).toEqual([false, true]);
    engine.speak('Hi', { voice: 'Samantha-from-another-computer', rate: 1 }, noop, noop);
    await flush();
    expect(client.synthesize).toHaveBeenCalledWith('Hi', 'Alex');
  });

  it('lists the system voices with the first as default', async () => {
    const { engine } = setup();
    expect(await engine.voices()).toEqual([{ id: 'Alex', name: 'Alex', language: 'en-US', isDefault: true }]);
  });

  it('reports each word when the audio reaches its time, then the end', async () => {
    const { audio, engine, tick, client } = setup();
    const words: [number, number][] = [];
    const onEnd = vi.fn();
    engine.speak('One two', { voice: 'Alex', rate: 1.5 }, (s, l) => words.push([s, l]), onEnd);
    await flush();
    expect(client.synthesize).toHaveBeenCalledWith('One two', 'Alex');
    expect(audio.playbackRate).toBe(1.5);
    tick();
    expect(words).toEqual([[0, 3]]);
    audio.time = 0.6;
    tick();
    expect(words).toEqual([
      [0, 3],
      [4, 3],
    ]);
    audio.onended?.();
    expect(onEnd).toHaveBeenCalledWith(true);
  });

  it('says it could not speak when synthesis fails, and stays quiet after a cancel', async () => {
    const failing = setup();
    vi.mocked(failing.client.synthesize).mockRejectedValueOnce(new Error('no voice'));
    const onEnd = vi.fn();
    failing.engine.speak('Hi', { voice: null, rate: 1 }, noop, onEnd);
    await flush();
    expect(onEnd).toHaveBeenCalledWith(false);

    const canceled = setup();
    const quiet = vi.fn();
    canceled.engine.speak('Hi', { voice: null, rate: 1 }, noop, quiet);
    canceled.engine.cancel();
    await flush();
    canceled.audio.onended?.();
    expect(quiet).not.toHaveBeenCalled();
  });

  it('speaks the voice the picker marks as default when none is chosen', async () => {
    const { engine, client } = setup();
    engine.speak('Hi', { voice: null, rate: 1 }, noop, noop);
    await flush();
    expect(client.synthesize).toHaveBeenCalledWith('Hi', 'Alex');
  });

  it('pauses and resumes the audio', async () => {
    const { audio, engine } = setup();
    engine.speak('Hi', { voice: null, rate: 1 }, noop, noop);
    await flush();
    engine.pause();
    expect(audio.pause).toHaveBeenCalled();
    engine.resume();
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
});

function fake(voices: number): SpeechEngine & { spoke: ReturnType<typeof vi.fn> } {
  const spoke = vi.fn();
  return {
    voices: () =>
      Promise.resolve(
        Array.from({ length: voices }, (_, i) => ({ id: `v${i}`, name: 'v', language: 'en', isDefault: i === 0 })),
      ),
    speak: spoke,
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    spoke,
  };
}

describe('stopping while the engine is choosing', () => {
  it('does not speak after Stop pressed in the window before the voices are known', async () => {
    const web = fake(0);
    const system = fake(2);
    const engine = createReadAloudEngine(web, system);
    engine?.speak('a', { voice: null, rate: 1 }, vi.fn(), vi.fn());
    engine?.cancel();
    await flush();
    expect(system.spoke).not.toHaveBeenCalled();
    expect(web.spoke).not.toHaveBeenCalled();
    engine?.speak('b', { voice: null, rate: 1 }, vi.fn(), vi.fn());
    await flush();
    expect(system.spoke).toHaveBeenCalledTimes(1);
  });

  it('keeps a pause pressed while choosing', async () => {
    const system = fake(2);
    const engine = createReadAloudEngine(fake(0), system);
    engine?.speak('a', { voice: null, rate: 1 }, vi.fn(), vi.fn());
    engine?.pause();
    await flush();
    expect(system.spoke).toHaveBeenCalledTimes(1);
    expect(system.pause).toHaveBeenCalledTimes(1);
  });
});

describe('choosing between the web view and the system', () => {
  it('uses the web view when it has voices', async () => {
    const web = fake(2);
    const system = fake(1);
    const engine = createReadAloudEngine(web, system);
    expect((await engine?.voices())?.length).toBe(2);
    engine?.speak('a', { voice: null, rate: 1 }, vi.fn(), vi.fn());
    await flush();
    expect(web.spoke).toHaveBeenCalled();
    expect(system.spoke).not.toHaveBeenCalled();
  });

  it('falls back to the system voices when the web view has none', async () => {
    const web = fake(0);
    const system = fake(3);
    const engine = createReadAloudEngine(web, system);
    expect((await engine?.voices())?.length).toBe(3);
    engine?.speak('a', { voice: null, rate: 1 }, vi.fn(), vi.fn());
    await flush();
    expect(system.spoke).toHaveBeenCalled();
    expect(web.spoke).not.toHaveBeenCalled();
  });

  it('is whichever engine exists when only one does', () => {
    const only = fake(1);
    expect(createReadAloudEngine(only, null)).toBe(only);
    expect(createReadAloudEngine(null, only)).toBe(only);
    expect(createReadAloudEngine(null, null)).toBeNull();
  });
});
