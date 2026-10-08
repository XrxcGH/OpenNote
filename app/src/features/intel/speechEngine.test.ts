// The on-device read-aloud engine, with the fake transport and a player that plays nothing. It checks what the page's
// reader relies on: word boundaries inside the text it gave, one chunk made ahead, the end reported once, and a
// cancel that stops at once. It also checks the default voice for a voice the crate doesn't know.
import { describe, expect, it } from 'vitest';
import { createFakeIntelTransport, createIntelClient } from '../../services/intel';
import { createOnDeviceSpeech } from './speechEngine';
import type { ClipPlayer } from './speechEngine';

/** A player whose clips last as long as the test lets them: `finish` ends the current one. */
function manualPlayer() {
  const plays: { times: (ms: number) => void; finish: () => void; stopped: boolean }[] = [];
  const make = (): ClipPlayer => {
    let current: (typeof plays)[number] | null = null;
    return {
      play: (_wav, onTime) =>
        new Promise<void>((resolve) => {
          current = { times: onTime, finish: resolve, stopped: false };
          plays.push(current);
        }),
      pause: () => undefined,
      resume: () => undefined,
      stop: () => {
        if (current) current.stopped = true;
        current?.finish();
      },
    };
  };
  return { make, plays };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function engineOver(options: Parameters<typeof createFakeIntelTransport>[0] = { settings: { readAloud: true } }) {
  const transport = createFakeIntelTransport(options);
  const player = manualPlayer();
  const engine = createOnDeviceSpeech({
    client: () => Promise.resolve(createIntelClient(transport)),
    player: player.make,
  });
  return { transport, player, engine };
}

describe('the on-device speech engine: voices and words', () => {
  it('lists the Windows voices with the first as the default', async () => {
    const { engine } = engineOver();
    expect(await engine.voices()).toEqual([
      { id: 'fake-voice', name: 'Fake voice', language: 'en-US', isDefault: true },
    ]);
  });

  it('lists no voices when read aloud is off, instead of failing', async () => {
    const { engine } = engineOver({});
    expect(await engine.voices()).toEqual([]);
  });

  it('reports each word at its place in the text while a chunk plays, then the end', async () => {
    const { engine, player } = engineOver();
    const words: string[] = [];
    const ends: boolean[] = [];
    const text = 'Cells make energy. Plants use light.';
    engine.speak(
      text,
      { voice: null, rate: 1 },
      (start, length) => words.push(text.slice(start, start + length)),
      (done) => ends.push(done),
    );
    await settle();
    // The first chunk is the first sentence, and the fake says each word lasts 300 ms.
    player.plays[0].times(0);
    player.plays[0].times(350);
    player.plays[0].times(700);
    player.plays[0].finish();
    await settle();
    player.plays[1].times(0);
    player.plays[1].times(300);
    player.plays[1].finish();
    await settle();
    expect(words).toEqual(['Cells', 'make', 'energy', 'Plants', 'use']);
    expect(ends).toEqual([true]);
  });
});

describe('the on-device speech engine: chunks and stopping', () => {
  it('makes the next chunk while the current one plays', async () => {
    const { engine, player, transport } = engineOver();
    engine.speak(
      'One sentence. Another sentence. A third one.',
      { voice: null, rate: 1 },
      () => undefined,
      () => undefined,
    );
    await settle();
    await settle();
    expect(player.plays).toHaveLength(1);
    expect(transport.calls.filter((call) => call === 'intel_read_aloud_next')).toHaveLength(2);
    engine.cancel();
  });

  it('stops at once on cancel, and reports no end', async () => {
    const { engine, player } = engineOver();
    const ends: boolean[] = [];
    engine.speak(
      'One sentence. Another one.',
      { voice: null, rate: 1 },
      () => undefined,
      (done) => ends.push(done),
    );
    await settle();
    engine.cancel();
    await settle();
    expect(player.plays[0].stopped).toBe(true);
    expect(player.plays).toHaveLength(1);
    expect(ends).toEqual([]);
  });

  it('reports a read that could not start, such as with read aloud off', async () => {
    const { engine } = engineOver({});
    const ends: boolean[] = [];
    engine.speak(
      'Hello there.',
      { voice: null, rate: 1 },
      () => undefined,
      (done) => ends.push(done),
    );
    await settle();
    expect(ends).toEqual([false]);
  });

  it('uses the default voice for a voice id it does not know', async () => {
    const { engine, transport } = engineOver();
    let sent: unknown = null;
    const original = transport.invoke.bind(transport);
    transport.invoke = ((command: string, args: unknown) => {
      if (command === 'intel_read_aloud_start') sent = args;
      return original(command as 'intel_status', args as Record<string, never>);
    }) as typeof transport.invoke;
    engine.speak(
      'Hello there.',
      { voice: 'Microsoft David Desktop', rate: 1.5 },
      () => undefined,
      () => undefined,
    );
    await settle();
    await settle();
    expect(sent).toMatchObject({ request: { text: 'Hello there.', speak: { voice: null, rate: 1.5 } } });
    engine.cancel();
  });
});
