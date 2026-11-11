// Where the studio's project lives. Usually it is a project block on the shown page. The studio reads the block's
// data from the page's block layer and sends each change to the page as a patch. So one undo on the page takes it
// back, and the card on the page follows. With no page open, the studio keeps a scratch project on this device.
// In a window of its own, the project comes through the relay (relay.ts).

import { applyMergePatch } from '../../../platform/mergePatch';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { shownMounted } from '../../page';
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
  dispose(): void;
}

export const SCRATCH = 'scratch';
const SCRATCH_KEY = 'opennote.codestudio.scratch';

/** A project block of the shown page, or null when the shown page has no such block. */
export function blockSource(block: string): ProjectSource | null {
  const mounted = shownMounted.get();
  const current = () => mounted?.layer.block(block) ?? null;
  const found = current();
  if (!mounted || !found || found.type !== CODE_PROJECT_TYPE) return null;
  let latest: BlockJson = found;
  const listeners = new Set<() => void>();
  const stop = mounted.layer.onChange(() => {
    const next = current();
    if (!next || next.data === latest.data) return;
    latest = next;
    for (const listener of listeners) listener();
  });
  return {
    key: block,
    kind: 'block',
    data: () => latest.data,
    readOnly: () => mounted.page.readOnly !== null,
    patch(data, fallback) {
      latest = { ...latest, data: applyMergePatch(latest.data, data), fallback: { markdown: fallback } } as BlockJson;
      void mounted.sync.send({ edits: [{ edit: 'patchBlock', block, data, fallback: { markdown: fallback } }] });
      // The card on the page draws the change too.
      mounted.layer.upsert(latest);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: stop,
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
    dispose: () => {},
  };
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
