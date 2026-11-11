// The diagnostics scheduler (DESIGN 6.1, ADR 0074). Each change of a file starts one timer per layer; when a layer's
// pause is over, its providers read that version. Every result carries the version it read, and a result for an
// older version is dropped (F18), so a slow checker can never paint marks on text that has moved.

import type { Diagnostic, DiagnosticResult } from '../contracts';
import { LAYER_DEBOUNCE_MS, LAYERS, type DiagnosticProvider, type DiagnosticRequest, type Layer } from './types';

/** Maps an offset of the previous version to the new one, as CodeMirror's `ChangeSet.mapPos` does. */
export type MapPos = (pos: number, assoc: -1 | 1) => number;

export interface SchedulerOptions {
  providers?: readonly DiagnosticProvider[];
  /** Gets a file's problems, all layers merged and sorted, each time they change. */
  publish(file: string, items: Diagnostic[]): void;
  /** Overrides the pause of some layers, in milliseconds. */
  debounce?: Partial<Record<Layer, number>>;
  /** Hears a provider that failed. The other layers carry on. */
  onError?(provider: DiagnosticProvider, error: unknown): void;
}

export interface DiagnosticsScheduler {
  /** A new version of a file. `map` keeps the shown problems on their text until the layers answer again. */
  update(request: DiagnosticRequest, map?: MapPos): void;
  /** Takes a provider's result. Returns false, and changes nothing, when the file has moved past its version. */
  accept(result: DiagnosticResult): boolean;
  register(provider: DiagnosticProvider): () => void;
  /** The problems shown for a file now. */
  current(file: string): Diagnostic[];
  /** Forgets a closed file and its timers. */
  close(file: string): void;
  dispose(): void;
}

interface Held {
  version: number;
  items: Diagnostic[];
}

function compare(a: Diagnostic, b: Diagnostic): number {
  return a.from - b.from || a.to - b.to || a.source.localeCompare(b.source);
}

export function createDiagnosticsScheduler(options: SchedulerOptions): DiagnosticsScheduler {
  const providers = new Set(options.providers ?? []);
  const docs = new Map<string, DiagnosticRequest>();
  const results = new Map<string, Map<string, Held>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pause = { ...LAYER_DEBOUNCE_MS, ...options.debounce };

  const merged = (file: string): Diagnostic[] => {
    const version = docs.get(file)?.version;
    const held = [...(results.get(file)?.values() ?? [])].filter((h) => h.version === version);
    return held.flatMap((h) => h.items).sort(compare);
  };

  const publish = (file: string) => options.publish(file, merged(file));

  const accept = (result: DiagnosticResult): boolean => {
    const doc = docs.get(result.file);
    if (!doc || doc.version !== result.version) return false;
    let bySource = results.get(result.file);
    if (!bySource) results.set(result.file, (bySource = new Map()));
    bySource.set(result.source, { version: result.version, items: result.items });
    publish(result.file);
    return true;
  };

  const runLayer = (request: DiagnosticRequest, layer: Layer) => {
    for (const provider of providers) {
      if (provider.layer !== layer || !provider.languages.includes(request.language)) continue;
      Promise.resolve()
        .then(() => provider.run(request))
        .then(
          (items) => accept({ file: request.file, version: request.version, source: provider.id, items }),
          (error: unknown) => options.onError?.(provider, error),
        );
    }
  };

  const clearTimers = (file: string) => {
    for (const layer of LAYERS) {
      const key = `${layer}\u0000${file}`;
      const timer = timers.get(key);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(key);
    }
  };

  const remap = (file: string, version: number, map: MapPos) => {
    for (const held of results.get(file)?.values() ?? []) {
      held.items = held.items.map((item) => {
        const from = map(item.from, 1);
        return { ...item, from, to: Math.max(from, map(item.to, -1)) };
      });
      held.version = version;
    }
  };

  return {
    update(request, map) {
      const before = docs.get(request.file);
      docs.set(request.file, request);
      if (map && before) remap(request.file, request.version, map);
      clearTimers(request.file);
      const layers = new Set([...providers].filter((p) => p.languages.includes(request.language)).map((p) => p.layer));
      for (const layer of layers) {
        timers.set(
          `${layer}\u0000${request.file}`,
          setTimeout(() => {
            timers.delete(`${layer}\u0000${request.file}`);
            runLayer(request, layer);
          }, pause[layer]),
        );
      }
    },
    accept,
    register(provider) {
      providers.add(provider);
      return () => {
        providers.delete(provider);
        for (const [file, bySource] of results) if (bySource.delete(provider.id)) publish(file);
      };
    },
    current: merged,
    close(file) {
      clearTimers(file);
      docs.delete(file);
      results.delete(file);
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      docs.clear();
      results.clear();
      providers.clear();
    },
  };
}
