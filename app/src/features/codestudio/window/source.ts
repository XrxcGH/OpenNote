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

/** A project block of a page view (by default the shown one), or null when the page has no such block. */
export function blockSource(block: string, mounted: MountedPage | null = shownMounted.get()): ProjectSource | null {
  const current = () => mounted?.layer.block(block) ?? null;
  const found = current();
  if (!mounted || !found || found.type !== CODE_PROJECT_TYPE) return null;
  const page = mounted;
  let latest: BlockJson = found;
  let gone = false;
  let removed = false;
  // A send the page refused: the page closed under it. The data goes back to what the page holds.
  let refused = false;
  const listeners = new Set<() => void>();
  const leaving = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const stopLayer = page.layer.onChange(() => {
    if (gone) return;
    const next = current();
    if (!next || next.type !== CODE_PROJECT_TYPE) {
      if (removed) return;
      removed = true;
      notify();
      return;
    }
    if (!removed && next.data === latest.data) return;
    removed = false;
    refused = false;
    latest = next;
    notify();
  });
  // The page hands its hooks a copy of the MountedPage (features/page/mount.ts), so the match is on its sync.
  const onLeaving = (event: Event) => {
    const detail = (event as CustomEvent<Partial<MountedPage> | null>).detail;
    if (detail === page || (detail && detail.sync === page.sync)) leave();
  };
  const stopShown = shownMounted.subscribe(() => {
    if (shownMounted.get() !== page) leave();
  });
  if (typeof window !== 'undefined') window.addEventListener(PAGE_LEAVING_EVENT, onLeaving);
  const stop = () => {
    stopLayer();
    stopShown();
    if (typeof window !== 'undefined') window.removeEventListener(PAGE_LEAVING_EVENT, onLeaving);
  };
  function leave(): void {
    if (gone) return;
    // The text still waiting goes to the page while its view can take it.
    for (const listener of [...leaving]) listener();
    gone = true;
    stop();
    notify();
  }
  return {
    key: block,
    kind: 'block',
    data: () => latest.data,
    readOnly: () => gone || removed || page.page.readOnly !== null,
    removed: () => removed,
    patch(data, fallback) {
      // The page or the block is gone: nothing is sent, so the studio keeps the file marked as not sent.
      if (gone || removed) return;
      if (!current()) {
        removed = true;
        notify();
        return;
      }
      const before = latest.data;
      latest = { ...latest, data: applyMergePatch(latest.data, data), fallback: { markdown: fallback } } as BlockJson;
      const sent = Promise.resolve(
        page.sync.send({ edits: [{ edit: 'patchBlock', block, data, fallback: { markdown: fallback } }] }),
      );
      sent.catch(() => {
        // The page did not take it. The data goes back, so the file reads as not sent.
        if (refused || gone) return;
        refused = true;
        latest = { ...latest, data: before } as BlockJson;
        // The block was deleted under the send. Otherwise the page closed, and the source lets go of it.
        if (!current()) removed = true;
        else {
          gone = true;
          stop();
        }
        notify();
      });
      // The card on the page draws the change too.
      page.layer.upsert(latest);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    live: () => !gone,
    onLeave(listener) {
      leaving.add(listener);
      return () => leaving.delete(listener);
    },
    dispose() {
      gone = true;
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
