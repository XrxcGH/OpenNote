// Where the intel client gets its transport and the person's choices (Phase 12). The build picks one, like
// platform/index.ts: the Tauri shell asks the Rust crate, and the web platform answers with the fake, which keeps
// the choices in this browser so a reload remembers them. Nothing here touches a network.
import type { IntelSettings, IntelTransport } from '../services/intel';

export interface IntelHost {
  transport: IntelTransport;
  /** What the person has turned on. Every feature starts off. */
  loadChoices(): Promise<IntelSettings>;
  /** Changes some features and returns all of them. */
  saveChoices(patch: Partial<IntelSettings>): Promise<IntelSettings>;
}

const KEY = 'opennote.intel.choices';

function remembered(): Partial<IntelSettings> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<IntelSettings>;
  } catch {
    return {};
  }
}

function remember(settings: IntelSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A browser that won't store them just forgets them at the next reload.
  }
}

async function webHost(): Promise<IntelHost> {
  const { createFakeIntelTransport } = await import('../services/intel/fake');
  const transport = createFakeIntelTransport({ settings: remembered() });
  const current = async () => {
    const status = await transport.invoke('intel_status', {});
    return Object.fromEntries(status.map((one) => [one.feature, one.enabled])) as unknown as IntelSettings;
  };
  return {
    transport,
    loadChoices: current,
    async saveChoices(patch) {
      transport.setSettings(patch);
      const next = await current();
      remember(next);
      return next;
    },
  };
}

async function tauriHost(): Promise<IntelHost> {
  const { createTauriIntelTransport, tauriIntelChoices } = await import('./tauri/intel');
  return {
    transport: createTauriIntelTransport(),
    loadChoices: tauriIntelChoices.load,
    saveChoices: tauriIntelChoices.save,
  };
}

export function loadIntelHost(): Promise<IntelHost> {
  return import.meta.env.VITE_PLATFORM === 'web' ? webHost() : tauriHost();
}
