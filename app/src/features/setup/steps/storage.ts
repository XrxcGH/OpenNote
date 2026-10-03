// What step 3 keeps in the draft, whether it may continue, and what it does at the end (ARCHITECTURE.md
// sections 17.5 and 17.6). The step's screen is StorageStep, which loads only when the step shows.

import type { Location } from '../../../app/location';
import type { FolderCheck } from '../../../platform/types';
import type { SetupContext, SetupDraft } from '../../../registries';
import type { ChipColor } from '../../../services/notes/types';
import { updateSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { OPEN_AFTER_SETUP } from '../model';

// checks-disable-next-line brand-consistency: pen names from the tokens, not CSS colors
export const NOTEBOOK_COLORS: readonly ChipColor[] = ['fern', 'brick', 'indigo', 'plum', 'amber'];
export const DEFAULT_NOTEBOOK_COLOR: ChipColor = 'fern';

/** What the folder check said about a path. The path says which folder the answer is for. */
export interface FolderStatus {
  path: string;
  check: FolderCheck;
}

const BLOCKING: ReadonlySet<FolderCheck['kind']> = new Set(['notWritable', 'insideAppFolder', 'notAbsolute']);

export const folderStatusOf = (draft: SetupDraft): FolderStatus | null =>
  (draft.folderStatus as FolderStatus | undefined) ?? null;

/** True when the answer is for the folder now chosen and is one OpenNote can work with. */
export function folderUsable(draft: SetupDraft): boolean {
  const status = folderStatusOf(draft);
  return status !== null && status.path === draft.storage?.notesFolder && !BLOCKING.has(status.check.kind);
}

/** A library that already exists is opened, so no first notebook is made. */
export const opensExistingLibrary = (draft: SetupDraft): boolean => folderStatusOf(draft)?.check.kind === 'hasLibrary';

export function canContinueStorage(draft: SetupDraft): boolean {
  if (!draft.storage || !folderUsable(draft)) return false;
  return opensExistingLibrary(draft) || draft.storage.notebookName.trim().length > 0;
}

/**
 * Saves the folder, which Rust creates, then makes the first notebook with a section and a page. A folder that
 * already holds notebooks, such as one copied or synced from another computer, opens as it is: asking the service
 * for its notebooks makes the core open them, and the tree hears about them.
 */
export async function commitStorage(ctx: SetupContext, draft: SetupDraft): Promise<void> {
  const { storage } = draft;
  if (!storage) return;
  await updateSettings({ storage: { notesFolder: storage.notesFolder } });
  if (opensExistingLibrary(draft)) {
    await ctx.notes.listNotebooks();
    return;
  }
  const end = { beforeId: null };
  const notebook = await ctx.notes.create({
    kind: 'notebook',
    placement: { parentId: null, ...end },
    title: storage.notebookName.trim(),
    color: storage.notebookColor,
  });
  const section = await ctx.notes.create({
    kind: 'section',
    placement: { parentId: notebook.id, ...end },
    title: t('setup.storage.notebook.firstSection'),
  });
  const page = await ctx.notes.create({ kind: 'page', placement: { parentId: section.id, ...end } });
  const location: Location = { view: 'workspace', notebookId: notebook.id, sectionId: section.id, pageId: page.id };
  draft[OPEN_AFTER_SETUP] = location;
}
