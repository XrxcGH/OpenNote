// The long engines as worker tasks: the signals worker's request and reply loop, run here through a stand-in scope,
// gives the same answers as the engines and brings an engine's problem back as its message key.
import { describe, expect, it } from 'vitest';
import { serveTasks, type TaskFn, type WorkerScope } from '../../subjects/num/worker';
import { CLIP_RATE } from '../audio/clip';
import { SIGNAL_TASKS, type TaskReply } from './tasks';

function serve() {
  const replies: { kind: string; output?: unknown; fraction?: number }[] = [];
  let listener: ((event: MessageEvent) => void) | null = null;
  const scope: WorkerScope = {
    postMessage: (message) => replies.push(message as (typeof replies)[number]),
    addEventListener: (_type, listen) => (listener = listen),
  };
  serveTasks(SIGNAL_TASKS as unknown as Record<string, TaskFn<never, unknown>>, scope);
  return {
    replies,
    send: (task: string, input: unknown) => listener!({ data: { kind: 'run', task, input } } as MessageEvent),
  };
}

const tone = (f: number, seconds: number, rate = CLIP_RATE) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / rate));

describe('signals worker tasks', () => {
  it('tracks a 20 s, 220 Hz tone with progress, past the old 15 s limit', () => {
    const { replies, send } = serve();
    send('pitch', { samples: tone(220, 20), rate: CLIP_RATE });
    const done = replies.at(-1)!;
    expect(done.kind).toBe('done');
    const reply = done.output as TaskReply<{ f0: number[]; times: number[] }>;
    if (!reply.ok) throw new Error(reply.key);
    const voiced = reply.value.f0.filter(Number.isFinite);
    // Frames every 10 ms over 20 s: about 2000 of them, all near 220 Hz.
    expect(voiced.length).toBeGreaterThan(1900);
    expect(Math.max(...voiced.map((f) => Math.abs(f - 220)))).toBeLessThan(0.5);
    expect(replies.some((r) => r.kind === 'progress' && r.fraction! > 0 && r.fraction! < 1)).toBe(true);
  });

  it('brings an engine problem back as its key', () => {
    const { replies, send } = serve();
    send('pitch', { samples: new Float32Array(10), rate: CLIP_RATE });
    expect(replies.at(-1)!.output).toEqual({ ok: false, key: 'tooShort', vars: {}, message: '' });
  });
});
