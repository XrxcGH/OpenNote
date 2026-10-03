// Read aloud on the client: the Rust crate's own notices, answered one per pull by a scripted transport.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createIntelClient } from './client';
import { isIntelError } from './errors';
import { pageSpan, wordAt } from './readAloud';
import type { IntelTransport } from './transport';
import type { ReadAloudNotice } from './types';

const WIRE = new URL('../../../../crates/intel/tests/fixtures/wire/', import.meta.url);

function notices(name: string): ReadAloudNotice[] {
  const json = JSON.parse(readFileSync(fileURLToPath(new URL(name, WIRE)), 'utf8')) as
    ReadAloudNotice | ReadAloudNotice[];
  return Array.isArray(json) ? json : [json];
}

/** A transport that answers each pull with the next of `answers`, and logs every command in order. */
function pulling(answers: ReadAloudNotice[], sessionId = 's1') {
  const log: string[] = [];
  const queue = [...answers];
  const transport: IntelTransport = {
    invoke: async (command, args) => {
      log.push(command);
      if (command === 'intel_read_aloud_start') return { sessionId, totalChunks: 2 } as never;
      if (command === 'intel_read_aloud_next') {
        expect(args).toEqual({ sessionId });
        const next = queue.shift();
        if (!next) throw { code: 'canceled', message: 'the session is over', feature: null };
        return next as never;
      }
      if (command === 'intel_clip_audio')
        return new Uint8Array([82, 73, 70, 70, (args as { clipId: string }).clipId.length]) as never;
      return null as never;
    },
  };
  return { transport, log };
}

const BOTH = 'First sentence here. Second sentence follows.';

describe('a read-aloud session', () => {
  it('yields the chunks the Rust crate sent, then ends without a cancel', async () => {
    const { transport, log } = pulling(notices('read_aloud_notices.json'));
    const session = await createIntelClient(transport).readAloud(BOTH);
    expect(session.totalChunks).toBe(2);
    const seen = [];
    for await (const chunk of session) seen.push(chunk);
    expect(seen.map((c) => [c.index, c.total])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(seen[0].span).toEqual({ start: 0, end: 20 });
    expect(seen[1].span.start).toBe(21);
    expect(log).not.toContain('intel_read_aloud_cancel');
  });

  it('pulls a chunk only when asked, and fetches its sound before handing it over', async () => {
    const { transport, log } = pulling(notices('read_aloud_notices.json'));
    const session = await createIntelClient(transport).readAloud(BOTH);
    expect(log).toEqual(['intel_read_aloud_start']);
    const [chunk] = await collect(session, 1);
    // One pull, then the sound, so the Rust side can drop the clip before anything else is asked for.
    expect(log.slice(1, 3)).toEqual(['intel_read_aloud_next', 'intel_clip_audio']);
    expect(log.filter((c) => c === 'intel_read_aloud_next')).toHaveLength(1);
    const first = await chunk.audio();
    expect(first).toBeInstanceOf(Uint8Array);
    expect(await chunk.audio()).toBe(first);
    expect(log.filter((c) => c === 'intel_clip_audio')).toHaveLength(1);
  });
});

describe('a read-aloud session that fails', () => {
  it('throws the Rust error after the chunks before it', async () => {
    const [chunk] = notices('read_aloud_notices.json');
    const { transport, log } = pulling([chunk, ...notices('read_aloud_failed.json')]);
    const session = await createIntelClient(transport).readAloud('This goes boom.');
    const iterator = session[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.index).toBe(0);
    const failure = await iterator.next().catch((e: unknown) => e);
    expect(isIntelError(failure, 'engine')).toBe(true);
    expect((await iterator.next()).done).toBe(true);
    expect(log).not.toContain('intel_read_aloud_cancel');
  });

  it('ends the session on both sides when a pull fails', async () => {
    const { transport, log } = pulling([]);
    const session = await createIntelClient(transport).readAloud(BOTH);
    const failure = await session[Symbol.asyncIterator]()
      .next()
      .catch((e: unknown) => e);
    expect(isIntelError(failure, 'canceled')).toBe(true);
    expect(log).toContain('intel_read_aloud_cancel');
  });
});

describe('ending a session', () => {
  it('cancels when the loop is left early, and when asked', async () => {
    const { transport, log } = pulling(notices('read_aloud_notices.json'));
    const client = createIntelClient(transport);
    const session = await client.readAloud(BOTH);
    for await (const chunk of session) {
      expect(chunk.index).toBe(0);
      break;
    }
    expect(log).toContain('intel_read_aloud_cancel');

    const second = await client.readAloud('One. Two.');
    await second.cancel();
    await second.cancel();
    expect(log.filter((c) => c === 'intel_read_aloud_cancel')).toHaveLength(2);
    expect((await second[Symbol.asyncIterator]().next()).done).toBe(true);
  });

  it('rejects with the code when the session cannot start', async () => {
    const refusing: IntelTransport = {
      invoke: async () => {
        throw { code: 'disabled', message: 'read aloud is turned off', field: 'readAloud' };
      },
    };
    const error = await createIntelClient(refusing)
      .readAloud('Hello there.')
      .catch((e: unknown) => e);
    expect(isIntelError(error, 'disabled')).toBe(true);
    expect((error as { feature: string }).feature).toBe('readAloud');
  });
});

async function collect<T>(items: AsyncIterable<T>, max: number): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) {
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

describe('finding the word being spoken', () => {
  const [first] = notices('read_aloud_notices.json');
  const chunk = first.kind === 'chunk' ? first : null;

  it('wordAt follows the clock and keeps the word before through a gap', () => {
    expect(chunk).not.toBeNull();
    const info = chunk!.info;
    const words = info.boundaries.filter((b) => b.kind === 'word');
    expect(wordAt(info, words[0].startMs)).toBe(words[0]);
    expect(wordAt(info, words[1].startMs)).toBe(words[1]);
    expect(wordAt(info, info.durationMs)).toBe(words[words.length - 1]);
    expect(wordAt({ durationMs: 0, boundaries: [] }, 5)).toBeNull();
  });

  it('pageSpan puts a boundary at its place in the whole text', () => {
    const page = 'First sentence here. Second sentence follows.';
    const notice = notices('read_aloud_notices.json')[1];
    if (notice.kind !== 'chunk') throw new Error('expected a chunk');
    const word = notice.info.boundaries.find((b) => b.kind === 'word')!;
    const { start, end } = pageSpan(notice, word);
    expect(page.slice(start, end)).toBe('Second');
  });
});
