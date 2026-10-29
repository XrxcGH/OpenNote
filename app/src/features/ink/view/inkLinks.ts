// Links on handwriting (flag ink.links): lasso some writing and make it a link to a page, a heading, a web address, or
// the moment in the recording it was written to. The links live in the page's view under `inkLinks`, a map from a link
// ID to the strokes it covers and its target, like object groups (ADR 0036). A link names its strokes, so it moves
// with them, and each change is a `setPage` patch: one undo step. Search reads the same map, so a link to a page
// counts in that page's backlinks. A stroke is in at most one link; a new link over it replaces the old.
import { newId } from '../../../editor/ids';
import type { Edit, OpenPage } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { say } from './say';
import { followView } from './host';
import type { InkHost, InkQueue, InkSelection } from './host';
import type { InkSurface } from './surface';

export type LinkTarget =
  | { readonly kind: 'page'; readonly page: string; readonly heading?: string }
  | { readonly kind: 'url'; readonly url: string }
  /** The recording as it was when the writing was written; found through the strokes' own start times. */
  | { readonly kind: 'recording' };

export interface InkLink {
  /** The ink block that holds the strokes. */
  readonly block: string;
  readonly strokes: readonly string[];
  readonly target: LinkTarget;
  /** What the link is called in the list and to a screen reader: the words, or the page's title. */
  readonly label: string;
}

export type InkLinks = ReadonlyMap<string, InkLink>;

const WEB = /^(https?:\/\/|mailto:)\S+$/i;

/** Whether text is an address a link may open: web pages and mail, nothing the system would run. */
export const isWebAddress = (text: string): boolean => WEB.test(text.trim());

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

function targetOf(value: unknown): LinkTarget | null {
  if (!value || typeof value !== 'object') return null;
  const target = value as Record<string, unknown>;
  if (target.kind === 'page' && typeof target.page === 'string') {
    return {
      kind: 'page',
      page: target.page,
      ...(typeof target.heading === 'string' && target.heading ? { heading: target.heading } : {}),
    };
  }
  if (target.kind === 'url' && typeof target.url === 'string' && isWebAddress(target.url)) {
    return { kind: 'url', url: target.url };
  }
  return target.kind === 'recording' ? { kind: 'recording' } : null;
}

/** The links a page view holds. Anything that is not a link is skipped. */
export function linksOf(view: unknown): Map<string, InkLink> {
  const held = (view as { inkLinks?: unknown } | null | undefined)?.inkLinks;
  const links = new Map<string, InkLink>();
  if (!held || typeof held !== 'object' || Array.isArray(held)) return links;
  for (const [id, value] of Object.entries(held as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const target = targetOf(record.target);
    const strokes = strings(record.strokes);
    if (!target || strokes.length === 0 || typeof record.block !== 'string') continue;
    links.set(id, {
      block: record.block,
      strokes,
      target,
      label: typeof record.label === 'string' ? record.label : '',
    });
  }
  return links;
}

/** The ids of the links that cover any of these strokes. */
export function linksTouched(links: InkLinks, strokes: readonly string[]): string[] {
  const chosen = new Set(strokes);
  return [...links].filter(([, link]) => link.strokes.some((id) => chosen.has(id))).map(([id]) => id);
}

/** The view patch that sets links, or removes them with null. */
export function linksEdit(changes: Readonly<Record<string, InkLink | null>>): Edit {
  const inkLinks: Record<string, unknown> = {};
  for (const [id, link] of Object.entries(changes)) {
    inkLinks[id] = link
      ? { block: link.block, strokes: [...link.strokes], target: link.target, label: link.label }
      : null;
  }
  return { edit: 'setPage', view: { inkLinks } };
}

export function applyLinks(links: InkLinks, changes: Readonly<Record<string, InkLink | null>>): Map<string, InkLink> {
  const next = new Map(links);
  for (const [id, link] of Object.entries(changes)) {
    if (link) next.set(id, link);
    else next.delete(id);
  }
  return next;
}

/** The change that links these strokes to a target, replacing the links they were in. Null with no strokes. */
export function makeLinkChange(
  links: InkLinks,
  strokes: readonly string[],
  block: string,
  target: LinkTarget,
  label: string,
  id: string = newId(),
): Record<string, InkLink | null> | null {
  if (strokes.length === 0) return null;
  const changes: Record<string, InkLink | null> = {};
  for (const old of linksTouched(links, strokes)) changes[old] = null;
  changes[id] = { block, strokes: [...strokes], target, label };
  return changes;
}

/** The change that takes the links on these strokes away. Null when they have none. */
export function removeLinkChange(links: InkLinks, strokes: readonly string[]): Record<string, InkLink | null> | null {
  const touched = linksTouched(links, strokes);
  return touched.length > 0 ? Object.fromEntries(touched.map((id) => [id, null])) : null;
}

/** The links whose strokes are all still on the page, for the list. */
export function liveLinks(links: InkLinks, live: (stroke: string) => boolean): [string, InkLink][] {
  return [...links]
    .map(([id, link]): [string, InkLink] => [id, { ...link, strokes: link.strokes.filter(live) }])
    .filter(([, link]) => link.strokes.length > 0);
}

// ---- the shown page's links ----

export const inkLinks = createStore<InkLinks>(new Map(), 'ink links');

let adopted: { page: string; stop: () => void } | null = null;

function adopt(page: OpenPage | null, queue: InkQueue | null): void {
  if (adopted && adopted.page === page?.id) return;
  adopted?.stop();
  adopted = null;
  inkLinks.set(new Map());
  if (!page) return;
  inkLinks.set(linksOf(page.initial.view));
  const stop = followView(page, queue, (view) => inkLinks.set(linksOf(view)));
  adopted = { page: page.id, stop };
}

/** Follows the shown page's links, including through an undo. */
export function installInkLinks(host: InkHost): () => void {
  adopt(host.page.get(), host.queue.get());
  const stopPage = host.page.subscribe(() => adopt(host.page.get(), host.queue.get()));
  return () => {
    stopPage();
    adopted?.stop();
    adopted = null;
  };
}

async function sendLinks(surface: InkSurface, changes: Record<string, InkLink | null>): Promise<boolean> {
  const ok = await surface.send({ edits: [linksEdit(changes)] }, () => undefined);
  if (ok) inkLinks.set((links) => applyLinks(links, changes));
  return ok;
}

/** Links the selected strokes to a target. */
export async function linkSelection(
  surface: InkSurface,
  selection: Pick<InkSelection, 'strokes'>,
  target: LinkTarget,
  label: string,
): Promise<boolean> {
  const first = surface.strokes([...selection.strokes])[0];
  if (!first) return false;
  const changes = makeLinkChange(inkLinks.get(), selection.strokes, first.block, target, label);
  if (!changes) return false;
  const ok = await sendLinks(surface, changes);
  if (ok) say(t('ink.links.made', { label }));
  return ok;
}

/** Takes the links off the selected strokes. */
export async function unlinkSelection(host: InkHost, surface: InkSurface): Promise<void> {
  const changes = removeLinkChange(inkLinks.get(), host.selection.get().strokes);
  if (!changes) return say(t('ink.links.none'));
  if (await sendLinks(surface, changes)) say(t('ink.links.removed'));
}

/** Whether the selection holds writing that is a link, for Remove link's enabled state. */
export const selectionLinked = (host: InkHost): boolean =>
  linksTouched(inkLinks.get(), host.selection.get().strokes).length > 0;
