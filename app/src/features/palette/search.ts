// Runs the palette's providers for a query and ranks what they find (ARCHITECTURE.md section 14.6).
// - Providers answer at once or later. Each new query aborts the last one's signal, and late answers are dropped.
// - The palette shows the best 100 results, in groups. A group goes where its best result ranks.
// - A provider that throws or rejects is left out, so one broken provider never empties the palette.

import type { PaletteFilterId, PaletteProvider, PaletteResult } from '../../registries/types';

export const RESULT_LIMIT = 100;

export interface ResultGroup {
  readonly id: string;
  readonly results: readonly PaletteResult[];
}

export interface Ranked {
  readonly groups: readonly ResultGroup[];
  /** Every result, in the order they show, for the arrow keys. */
  readonly flat: readonly PaletteResult[];
  /** How many results the providers found, before the limit. */
  readonly total: number;
  /** Whether every provider has answered, so an empty list means nothing matched rather than not yet. */
  readonly settled: boolean;
}

export const NO_RESULTS: Ranked = { groups: [], flat: [], total: 0, settled: false };

/** The best results by score, grouped. Ties keep the order the providers gave. */
export function rank(results: readonly PaletteResult[], limit = RESULT_LIMIT): Ranked {
  const found = results.filter((result) => result.score > 0);
  const best = found
    .map((result, index) => ({ result, index }))
    .sort((a, b) => b.result.score - a.result.score || a.index - b.index)
    .slice(0, limit)
    .map(({ result }) => result);
  const order = [...new Set(best.map((result) => result.group))];
  const groups = order.map((id) => ({ id, results: best.filter((result) => result.group === id) }));
  return { groups, flat: groups.flatMap((group) => group.results), total: found.length, settled: true };
}

export function providersFor(providers: readonly PaletteProvider[], filter: PaletteFilterId): PaletteProvider[] {
  return filter === 'all' ? [...providers] : providers.filter((provider) => provider.filter === filter);
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | null)?.then === 'function';
}

/** One palette's searches. Subscribe to hear when results change; `settled` resolves when every provider answered. */
export class PaletteSearch {
  private ranked: Ranked = NO_RESULTS;
  private controller: AbortController | null = null;
  private pending: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly adjust: (results: PaletteResult[], query: string) => PaletteResult[] = (r) => r) {}

  readonly get = (): Ranked => this.ranked;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  settled(): Promise<Ranked> {
    return this.pending.then(() => this.ranked);
  }

  run(query: string, providers: readonly PaletteProvider[]): void {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const found: PaletteResult[] = [];
    let waiting = 0;
    const publish = () => {
      if (controller.signal.aborted) return;
      this.ranked = { ...rank(this.adjust([...found], query)), settled: waiting === 0 };
      this.listeners.forEach((listener) => listener());
    };
    const later: Promise<void>[] = [];
    for (const provider of providers) {
      try {
        const answer = provider.search(query, controller.signal);
        if (!isPromise(answer)) found.push(...answer);
        else {
          waiting += 1;
          later.push(
            answer
              .then(
                (list) => void found.push(...list),
                () => undefined,
              )
              .then(() => {
                waiting -= 1;
                publish();
              }),
          );
        }
      } catch {
        // Left out; the other providers still answer.
      }
    }
    publish();
    this.pending = Promise.all(later).then(() => undefined);
  }

  /** Stops the running search. Subscribers stay, because React subscribes and unsubscribes on its own. */
  dispose(): void {
    this.controller?.abort();
  }
}
