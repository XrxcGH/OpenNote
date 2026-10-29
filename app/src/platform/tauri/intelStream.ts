// The shell's live speech sessions: `intel_stream_start` opens the microphone and the model, and `intel_stream_stop`
// closes them. Every update of every session arrives on one event, `intel-stream`, as `{ session, update }`.
import { invoke, listen } from './invoke';
import type { Events } from './invoke';
import type { StreamRequest, StreamUpdate } from '../intelStream';

type Call = (command: string, args?: unknown) => Promise<unknown>;
type Listen = (event: string, handler: (payload: unknown) => void) => () => void;

export const tauriStream = {
  start: (request: StreamRequest) => (invoke as unknown as Call)('intel_stream_start', { request }) as Promise<string>,
  stop: (session: string) => (invoke as unknown as Call)('intel_stream_stop', { session }) as Promise<boolean>,
  listen(handler: (session: string, update: StreamUpdate) => void): () => void {
    return (listen as unknown as Listen)('intel-stream' as keyof Events, (payload) => {
      const { session, update } = payload as { session: string; update: StreamUpdate };
      handler(session, update);
    });
  },
};
