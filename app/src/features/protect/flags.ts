// The storage and protection features' flags (beta 5, storage-protect lane). app/flags.ts joins these to its list,
// so they load at start-up. Each is on in development, nightly, and Beta builds, and off in Stable until it meets
// the definition of done.
import type { FlagDef } from '../../app/flags';

export type ProtectFlagId =
  /** Empty Trash, Delete forever, and Delete folder for a notebook in Trash. */
  | 'trash.purge'
  /** Renaming a notebook renames its folder. */
  | 'notes.renameFolders'
  /** Settings, then Storage: Change notes folder. */
  | 'storage.changeFolder'
  /** Lock entry: a stamped, read-only page. */
  | 'page.lockEntry'
  /** Password-protected sections, with Windows Hello. */
  | 'sections.protect';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const building = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: ProtectFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: building,
});

export const PROTECT_FLAGS: readonly FlagDef[] = [
  flag('trash.purge', 'Empty Trash, Delete forever, and Delete folder for a notebook in Trash.'),
  flag('notes.renameFolders', 'Renaming a notebook renames its folder, when the setting is on.'),
  flag('storage.changeFolder', 'Change the notes folder, moving the notebooks or using the ones already there.'),
  flag('page.lockEntry', 'Lock entry: a read-only page stamped with the time, for lab notebooks and records.'),
  flag('sections.protect', 'Password-protected sections, encrypted on disk, with Windows Hello.'),
];
