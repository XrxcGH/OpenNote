// A cell's printed text inside the worker: gathered into pieces, sent to the page as text, and cut off past the limit.
import type { Stream, WorkerMessage } from './protocol';

const PIECE = 4096;

export class Output {
  private pending = '';
  private stream: Stream = 'out';
  private sent = 0;
  private decoders = { out: new TextDecoder(), err: new TextDecoder() };
  truncated = false;

  constructor(
    private send: (message: WorkerMessage) => void,
    private limit: number,
  ) {}

  write(stream: Stream, text: string): void {
    if (this.truncated || text === '') return;
    if (stream !== this.stream) this.flush();
    this.stream = stream;
    const room = this.limit - this.sent - this.pending.length;
    if (text.length > room) {
      this.pending += text.slice(0, Math.max(0, room));
      this.truncated = true;
      this.flush();
      return;
    }
    this.pending += text;
    if (this.pending.length >= PIECE) this.flush();
  }

  /** One byte of the UTF-8 stream, as the Python runtime prints. */
  byte(stream: Stream, value: number): void {
    this.write(stream, this.decoders[stream].decode(new Uint8Array([value]), { stream: true }));
  }

  flush(): void {
    if (this.pending === '') return;
    this.sent += this.pending.length;
    this.send({ kind: 'out', stream: this.stream, text: this.pending });
    this.pending = '';
  }
}
