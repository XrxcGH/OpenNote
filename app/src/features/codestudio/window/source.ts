// Where the studio's project lives. Usually it is a project block on the shown page. The studio reads the block's
// data from the page's block layer and sends each change to the page as a patch. So one undo on the page takes it
// back, and the card on the page follows. With no page open, the studio keeps a scratch project on this device.
// In a window of its own, the project comes through the relay (relay.ts).
//
// A block source belongs to one page view. That page may close, or another page may be shown. The source then lets
// the studio send the text still waiting, and lets go. From then on it reads as read-only and sends nothing. So a
// file typed into later stays marked as not sent. The studio binds to the block again when its page comes back.

import { applyMergePatch } from '../../../platform/mergePatch';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { shownMounted } from '../../page';
import type { MountedPage } from '../../page';
import { CODE_PROJECT_TYPE } from '../contracts';
import { projectFallback } from '../project/fallback';
import { readProject, starterProject } from '../project/model';

export interface ProjectSource {
  /** The block ID, or "scratch". */
  readonly key: string;
  readonly kind: 'block' | 'scratch' | 'remote';
  data(): Record<string, unknown>;
  readOnly(): boolean;
  /** Sends a merge patch of the data and the new fallback. */
  patch(data: Record<string, unknown>, fallback: string): void;
  /** Tells of newer data from elsewhere: the page's undo, another device, or the other window. */
  subscribe(listener: () => void): () => void;
  /** False once the source has let go of its page: it reads as read-only and sends nothing. */
  live(): boolean;
  /**
   * True while the project block is gone from its page, for example deleted there. The source then reads as
   * read-only and sends nothing, and binds again if the block comes back through undo.
   */
  removed?(): boolean;
  /** Runs just before the source lets go of its page, while a patch still reaches the page. */
  onLeave(listener: () => void): () => void;
  dispose(): void;
}

/**
 * The event the page sends as a page view starts to close, before it sends its last changes
 * (features/page/registrations/codeStudio.ts). Its detail is the MountedPage.
 */
export const PAGE_LEAVING_EVENT = 'opennote:codestudio-page-leaving';

export const SCRATCH = 'scratch';
const SCRATCH_KEY = 'opennote.codestudio.scratch';

/** What a block source knows of its block, shared by the helpers below. */
interface BlockState {
  latest: BlockJson;
  /** The source let go of its page. */
  gone: boolean;
  /** The block is gone from its page. */
  removed: boolean;
  /** A send the page refused: the page closed under it. */
  refused: boolean;
  readonly listeners: Set<() => void>;
  readonly leaving: Set<() => void>;
}

const notify = (state: BlockState): void => {
  for (const listener of [...state.listeners]) listener();
};

/** The page's block layer changed: the block changed, left the page, or came back. */
function layerChanged(block: string, page: MountedPage, state: BlockState): void {
  if (state.gone) return;
  const next = page.layer.block(block);
  if (!next || next.type !== CODE_PROJECT_TYPE) {
    if (state.removed) return;
    state.removed = true;
    notify(state);
    return;
  }
  if (!state.removed && next.data === state.latest.data) return;
  state.removed = false;
  state.refused = false;
  state.latest = next;
  notify(state);
}

/** Follows the block and its page view: the layer's changes, the view closing, another page shown. Returns the undo. */
function watchBlock(block: string, page: MountedPage, state: BlockState, leave: () => void): () => void {
  const stopLayer = page.layer.onChange(() => layerChanged(block, page, state));
  // The page hands its hooks a copy of the MountedPage (features/page/mount.ts), so the match is on its sync.
  const onLeaving = (event: Event) => {
    const detail = (event as CustomEvent<Partial<MountedPage> | null>).detail;
    if (detail === page || (detail && detail.sync === page.sync)) leave();
  };
  const stopShown = shownMounted.subscribe(() => {
    if (shownMounted.get() !== page) leave();
  });
  if (typeof window !== 'undefined') window.addEventListener(PAGE_LEAVING_EVENT, onLeaving);
  return () => {
    stopLayer();
    stopShown();
    if (typeof window !== 'undefined') window.removeEventListener(PAGE_LEAVING_EVENT, onLeaving);
  };
}

/** Lets go of the page. The text still waiting goes to the page first, while its view can take it. */
function leaveBlock(state: BlockState, stop: () => void): void {
  if (state.gone) return;
  for (const listener of [...state.leaving]) listener();
  state.gone = true;
  stop();
  notify(state);
}

/** The page did not take a send. The data goes back, so the file reads as not sent. */
function sendRefused(block: string, page: MountedPage, state: BlockState, stop: () => void, before: unknown): void {
  if (state.refused || state.gone) return;
  state.refused = true;
  state.latest = { ...state.latest, data: before } as BlockJson;
  // The block was deleted under the send. Otherwise the page closed, and the source lets go of it.
  if (!page.layer.block(block)) state.removed = true;
  else {
    state.gone = true;
    stop();
  }
  notify(state);
}

/** Sends a merge patch to the page, and draws it on the card. Nothing is sent once the page or the block is gone. */
function sendPatch(
  block: string,
  page: MountedPage,
  state: BlockState,
  stop: () => void,
  patch: { data: Record<string, unknown>; fallback: string },
): void {
  // The studio then keeps the file marked as not sent.
  if (state.gone || state.removed) return;
  if (!page.layer.block(block)) {
    state.removed = true;
    notify(state);
    return;
  }
  const { data, fallback } = patch;
  const before = state.latest.data;
  state.latest = {
    ...state.latest,
    data: applyMergePatch(state.latest.data, data),
    fallback: { markdown: fallback },
  } as BlockJson;
  const sent = Promise.resolve(
    page.sync.send({ edits: [{ edit: 'patchBlock', block, data, fallback: { markdown: fallback } }] }),
  );
  sent.catch(() => sendRefused(block, page, state, stop, before));
  // The card on the page draws the change too.
  page.layer.upsert(state.latest);
}

/** A project block of a page view (by default the shown one), or null when the page has no such block. */
export function blockSource(block: string, mounted: MountedPage | null = shownMounted.get()): ProjectSource | null {
  const found = mounted?.layer.block(block) ?? null;
  if (!mounted || !found || found.type !== CODE_PROJECT_TYPE) return null;
  const page = mounted;
  const state: BlockState = {
    latest: found,
    gone: false,
    removed: false,
    refused: false,
    listeners: new Set(),
    leaving: new Set(),
  };
  const stop: () => void = watchBlock(block, page, state, () => leaveBlock(state, stop));
  return {
    key: block,
    kind: 'block',
    data: () => state.latest.data,
    readOnly: () => state.gone || state.removed || page.page.readOnly !== null,
    removed: () => state.removed,
    patch: (data, fallback) => sendPatch(block, page, state, stop, { data, fallback }),
    subscribe(listener) {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    live: () => !state.gone,
    onLeave(listener) {
      state.leaving.add(listener);
      return () => state.leaving.delete(listener);
    },
    dispose() {
      state.gone = true;
      stop();
    },
  };
}

function readScratch(): Record<string, unknown> {
  try {
    const text = localStorage.getItem(SCRATCH_KEY);
    if (text) return readProject(JSON.parse(text) as Record<string, unknown>) as unknown as Record<string, unknown>;
  } catch {
    // A fresh scratch project instead.
  }
  return starterProject(t('codeStudio.studio.scratchName'), t('codeStudio.project.starterMain')) as unknown as Record<
    string,
    unknown
  >;
}

/** A project kept on this device only, for trying things out without a page. */
export function scratchSource(): ProjectSource {
  let data = readScratch();
  return {
    key: SCRATCH,
    kind: 'scratch',
    data: () => data,
    readOnly: () => false,
    patch(patch) {
      data = applyMergePatch(data, patch);
      try {
        localStorage.setItem(SCRATCH_KEY, JSON.stringify(data));
      } catch {
        // Kept for this session only.
      }
    },
    subscribe: () => () => {},
    live: () => true,
    onLeave: () => () => {},
    dispose: () => {},
  };
}

/** The scratch project kept on this device, or null when there is none yet. */
export function storedScratch(): Record<string, unknown> | null {
  try {
    const text = localStorage.getItem(SCRATCH_KEY);
    return text
      ? (readProject(JSON.parse(text) as Record<string, unknown>) as unknown as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Replaces the scratch project, as New project does when no page is open. */
export function resetScratch(data: Record<string, unknown>): void {
  try {
    localStorage.setItem(SCRATCH_KEY, JSON.stringify(data));
  } catch {
    // Nothing kept.
  }
}

/** The fallback a patch carries. */
export const fallbackOf = (data: Record<string, unknown>): string => projectFallback(readProject(data));
