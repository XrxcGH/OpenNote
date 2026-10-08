// The shell's on-device speech jobs (Phase 12): `intel_transcribe` starts a job and `intel_transcribe_cancel` stops
// one. Every update of every job arrives on one event, `intel-transcribe`, as `{ job, update }`.
import { invoke, listen } from './invoke';
import type { Events } from './invoke';
import type { SpeechJobRequest, SpeechJobUpdate } from '../intelSpeech';

type Call = (command: string, args?: unknown) => Promise<unknown>;
type Listen = (event: string, handler: (payload: unknown) => void) => () => void;

export const tauriSpeech = {
  start: (request: SpeechJobRequest) => (invoke as unknown as Call)('intel_transcribe', { request }) as Promise<string>,
  cancel: (job: string) => (invoke as unknown as Call)('intel_transcribe_cancel', { job }) as Promise<boolean>,
  listen(handler: (job: string, update: SpeechJobUpdate) => void): () => void {
    return (listen as unknown as Listen)('intel-transcribe' as keyof Events, (payload) => {
      const { job, update } = payload as { job: string; update: SpeechJobUpdate };
      handler(job, update);
    });
  },
};
