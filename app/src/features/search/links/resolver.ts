// What each [[page link]] points at, remembered while the editors show it. A link is asked about once, in a batch
// with the others on screen; the answer is dropped when the index or the tree changes, and the editors ask again.
import { fold } from '../../../services/search/text';
import type { LinkRef, Resolution } from '../../../services/search/types';
import { maybeSearchClient } from '../client';

const cache = new Map<string, Resolution>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let from: string | undefined;
let timer: ReturnType<typeof setTimeout> | null = null;

const BATCH_MS = 40;

function keyOf(link: LinkRef): string {
  return `${fold(link.title).trim()}#${fold(link.heading ?? '')}`;
}

/** The page the links are read from, so a title shared by several pages opens the closest. */
export function setLinkSource(page: string | undefined): void {
  if (page === from) return;
  from = page;
  invalidateLinks();
}

export function cachedResolution(link: LinkRef): Resolution | undefined {
  return cache.get(keyOf(link));
}

export function onResolutions(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function flush(pending: Map<string, LinkRef>) {
  const client = maybeSearchClient();
  if (!client || pending.size === 0) return;
  const keys = [...pending.keys()];
  const links = [...pending.values()];
  client
    .resolve(links, from)
    .then((answers) => {
      keys.forEach((key, at) => {
        if (answers[at]) cache.set(key, answers[at]);
      });
      listeners.forEach((listener) => listener());
    })
    .catch(() => keys.forEach((key) => asked.delete(key)));
}

const waiting = new Map<string, LinkRef>();

/** Asks about the links not yet known. The answers arrive together, and the listeners hear of them. */
export function requestResolutions(links: readonly LinkRef[]): void {
  for (const link of links) {
    const key = keyOf(link);
    if (cache.has(key) || asked.has(key)) continue;
    asked.add(key);
    waiting.set(key, link);
  }
  if (waiting.size === 0 || timer) return;
  timer = setTimeout(() => {
    timer = null;
    const batch = new Map(waiting);
    waiting.clear();
    flush(batch);
  }, BATCH_MS);
}

/** Forgets every answer, because a title or a page changed. The editors ask again. */
export function invalidateLinks(): void {
  cache.clear();
  asked.clear();
  listeners.forEach((listener) => listener());
}

/** Waits for the answer to one link, for following it. */
export async function resolveNow(link: LinkRef): Promise<Resolution | null> {
  const client = maybeSearchClient();
  if (!client) return null;
  const [answer] = await client.resolve([link], from);
  return answer ?? null;
}
