// On-device intelligence through the shell (Phase 12): the intel client's transport, and the person's choices.
// Every command here ends in `Engines` in the Rust crate, which refuses a feature that is off.
import type { IntelCommands, IntelSettings, IntelTransport } from '../../services/intel';
import { invoke } from './invoke';

type None = Record<string, never>;

/** The commands that keep the person's choices. The others are the intel client's (IntelCommands). */
export interface IntelChoiceCommands {
  intel_settings_get: { args: None; result: IntelSettings };
  intel_settings_set: { args: { patch: Partial<IntelSettings> }; result: IntelSettings };
}

type Call = (command: string, args?: unknown) => Promise<unknown>;
const call = invoke as unknown as Call;

export function createTauriIntelTransport(): IntelTransport {
  return {
    invoke: async <K extends keyof IntelCommands>(command: K, args: IntelCommands[K]['args']) =>
      (await call(command, args)) as IntelCommands[K]['result'],
  };
}

export const tauriIntelChoices = {
  load: () => call('intel_settings_get') as Promise<IntelSettings>,
  save: (patch: Partial<IntelSettings>) => call('intel_settings_set', { patch }) as Promise<IntelSettings>,
};
