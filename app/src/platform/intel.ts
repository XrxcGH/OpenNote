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
const INK_SCRIPT_KEY = 'opennote.preview.ink';

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

const STORE_KEY = 'opennote.intel.store';
const MODELS_KEY = 'opennote.intel.models';
const PREVIEW_TICK_MS = 150;
const PREVIEW_BYTES_PER_TICK = 60_000_000;

const storePersistence = {
  load(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  },
  loadInstalled(): string[] {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(MODELS_KEY) ?? '[]');
      return Array.isArray(saved) ? saved.filter((one): one is string => typeof one === 'string') : [];
    } catch {
      return [];
    }
  },
  saveInstalled(ids: readonly string[]): void {
    try {
      localStorage.setItem(MODELS_KEY, JSON.stringify(ids));
    } catch {
      // A browser that won't store them just forgets them at the next reload.
    }
  },
  save(files: ReadonlyMap<string, string>): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(files)));
    } catch {
      // A browser that won't store them just forgets them at the next reload.
    }
  },
};

/**
 * What scripted handwriting says in the web preview, for trying handwriting features without a recognizer: session
 * storage may hold a list of { from, to, text }, and strokes whose middle lies between from and to (across the page)
 * read as that text. Nothing is scripted unless the list is there.
 */
function scriptedInk(strokes: readonly { points: readonly (readonly [number, number])[] }[]): string | null {
  try {
    const script = JSON.parse(sessionStorage.getItem(INK_SCRIPT_KEY) ?? '[]') as {
      from: number;
      to: number;
      text: string;
    }[];
    const xs = strokes.flatMap((stroke) => stroke.points.map((point) => point[0]));
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    return script.find((one) => middle >= one.from && middle <= one.to)?.text ?? null;
  } catch {
    return null;
  }
}

async function webHost(): Promise<IntelHost> {
  const { createFakeIntelTransport } = await import('../services/intel/fake');
  const transport = createFakeIntelTransport({
    settings: remembered(),
    persistence: storePersistence,
    readInk: scriptedInk,
  });
  // A model "downloads" here in a few seconds without touching a network, so the screens can be tried in a browser.
  setInterval(() => transport.ext.tick(PREVIEW_BYTES_PER_TICK), PREVIEW_TICK_MS);
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
