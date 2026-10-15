// Where the intel client gets its transport and the person's choices (Phase 12). The build picks one, like
// platform/index.ts: the Tauri shell asks the Rust crate, and the web platform answers with the fake, which keeps
// the choices and the device store's files in this browser so a reload remembers them. Nothing here touches a
// network.
import type { IntelSettings, IntelTransport } from '../services/intel';
import type { ExtFiles } from '../services/intel/extFake';

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

/** Where the web platform keeps the device store's files: one browser storage item each. */
export const DEVICE_FILE_PREFIX = 'opennote.device.';

/**
 * The device store's files in the browser's storage, so they outlast a reload as the shell's device folder does.
 * A write the browser refuses (it is full) throws, so the caller reports it.
 */
export function browserFiles(storage: Storage = localStorage): ExtFiles {
  const key = (name: string) => DEVICE_FILE_PREFIX + name;
  return {
    get: (name) => storage.getItem(key(name)) ?? undefined,
    set: (name, text) => storage.setItem(key(name), text),
    delete: (name) => storage.removeItem(key(name)),
    keys() {
      const found: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const one = storage.key(i);
        if (one?.startsWith(DEVICE_FILE_PREFIX)) found.push(one.slice(DEVICE_FILE_PREFIX.length));
      }
      return found;
    },
  };
}

async function webHost(): Promise<IntelHost> {
  const { createFakeIntelTransport } = await import('../services/intel/fake');
  const transport = createFakeIntelTransport({ settings: remembered(), files: browserFiles() });
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
