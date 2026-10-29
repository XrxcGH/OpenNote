// Reading a page aloud: the client side of a Rust read-aloud session (crates/intel/src/wire/hub.rs). The client
// pulls one notice with intel_read_aloud_next only when the player asks for the next chunk. The Rust side therefore
// synthesizes a few chunks ahead at most. Each chunk's sound is fetched before the chunk is handed over, so the Rust
// side can drop it, and nothing is left behind when the session ends.

import { IntelClientError, toIntelError } from './errors';
import type { IntelTransport, RawBytes } from './transport';
import type { Boundary, ReadAloudNotice, ReadAloudRequest, ReadAloudStarted, Span, SpeechInfo } from './types';

export interface ReadAloudChunk {
  /** The chunk's position, counting from 0. */
  index: number;
  total: number;
  /** Where the chunk sits in the text that was sent. Add `span.start` to a boundary's offsets to find it there. */
  span: Span;
  info: SpeechInfo;
  /** The WAV file, fetched with the chunk. */
  audio(): Promise<Uint8Array>;
}

/** Iterate with `for await`. Each step pulls one chunk. Leaving the loop early cancels the session. */
export interface ReadAloudSession extends AsyncIterable<ReadAloudChunk> {
  readonly sessionId: string;
  readonly totalChunks: number;
  /** Stops reading, and the Rust side drops the chunks made ahead. Safe to call more than once. */
  cancel(): Promise<void>;
}

export function toBytes(raw: RawBytes): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return Uint8Array.from(raw);
}

/** The word being spoken `atMs` into a clip. A gap between words keeps the word before. */
export function wordAt(info: SpeechInfo, atMs: number): Boundary | null {
  let found: Boundary | null = null;
  for (const boundary of info.boundaries) {
    if (boundary.kind !== 'word') continue;
    if (boundary.startMs > atMs) break;
    found = boundary;
  }
  return found;
}

/** Where a boundary of a chunk sits in the whole text. */
export function pageSpan(chunk: Pick<ReadAloudChunk, 'span'>, boundary: Pick<Boundary, 'text'>): Span {
  return { start: chunk.span.start + boundary.text.start, end: chunk.span.start + boundary.text.end };
}

export async function startReadAloud(transport: IntelTransport, request: ReadAloudRequest): Promise<ReadAloudSession> {
  try {
    return new Session(transport, await transport.invoke('intel_read_aloud_start', { request }));
  } catch (error) {
    throw toIntelError(error);
  }
}

class Session implements ReadAloudSession, AsyncIterator<ReadAloudChunk> {
  readonly sessionId: string;
  readonly totalChunks: number;
  /** Over: finished, failed, or canceled. The Rust side has dropped the session. */
  private ended = false;

  constructor(
    private readonly transport: IntelTransport,
    started: ReadAloudStarted,
  ) {
    this.sessionId = started.sessionId;
    this.totalChunks = started.totalChunks;
  }

  [Symbol.asyncIterator](): AsyncIterator<ReadAloudChunk> {
    return this;
  }

  async next(): Promise<IteratorResult<ReadAloudChunk>> {
    if (this.ended) return { value: undefined, done: true };
    let notice: ReadAloudNotice;
    let audio: Uint8Array;
    try {
      notice = await this.transport.invoke('intel_read_aloud_next', { sessionId: this.sessionId });
      if (notice.kind !== 'chunk') {
        this.ended = true;
        if (notice.kind === 'finished') return { value: undefined, done: true };
        throw new IntelClientError(notice.error.code, notice.error.message, notice.error.feature);
      }
      audio = toBytes(await this.transport.invoke('intel_clip_audio', { clipId: notice.clipId }));
    } catch (error) {
      // A failed pull or fetch leaves the session in an unknown state, so it is ended on both sides.
      await this.cancel();
      throw toIntelError(error);
    }
    const sound = Promise.resolve(audio);
    const { index, total, span, info } = notice;
    return { value: { index, total, span, info, audio: () => sound }, done: false };
  }

  /** Called when a `for await` loop is left early. */
  async return(): Promise<IteratorResult<ReadAloudChunk>> {
    await this.cancel();
    return { value: undefined, done: true };
  }

  async cancel(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    // Stopping is best effort: the session may already be over on the Rust side.
    await this.transport.invoke('intel_read_aloud_cancel', { sessionId: this.sessionId }).catch(() => null);
  }
}
