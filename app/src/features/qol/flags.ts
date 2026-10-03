// The shell and storage quality-of-life features' flags. app/flags.ts joins these to its list, so they load at
// start-up. Each is on in every channel, because each works end to end in the running app.
import type { FlagDef, FlagId } from '../../app/flags';

export type QolFlagId = Extract<FlagId, `qol.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: QolFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: on,
});

export const QOL_FLAGS: readonly FlagDef[] = [
  flag('qol.multiSelect', 'Select several pages or sections, then move, copy, color, or delete them together.'),
  flag('qol.pins', 'Pin, sort, and duplicate pages and sections, and Copy to.'),
  flag('qol.tabs', 'Several pages in tabs, and pages in windows of their own.'),
  flag('qol.recentlyClosed', 'Reopen closed tabs with Ctrl+Shift+T, and list them in the palette.'),
  flag('qol.dock', 'Dock OpenNote as a narrow column at a screen edge.'),
  flag('qol.scheduledBackups', 'Backups on a schedule to a folder the person picks.'),
  flag('qol.externalEdits', 'Watch the notes folder and reload pages that other programs change.'),
  flag('qol.cloudFolders', 'A notice when the notes folder is in OneDrive, Dropbox, iCloud Drive, or Google Drive.'),
  flag('qol.openFolder', 'Open a notebook from any folder, in place.'),
  flag('qol.checkNotebook', 'Check a notebook for problems, with a repair for each.'),
  flag('qol.quickCapture', 'A global shortcut that opens a small note window from anywhere in Windows.'),
  flag('qol.focusMode', 'Hide the panes and toolbars so the page stands alone.'),
  flag('qol.miniWindow', 'Keep OpenNote on top of other apps.'),
  flag('qol.lowPower', 'Reduce animations and background work on battery.'),
  flag('qol.archive', 'Archive finished pages, sections, and notebooks out of the tree.'),
  flag('qol.home', 'The Home page: recent and pinned pages, today, and saved searches.'),
  flag('qol.shortcuts', 'Windows shortcuts to pages, and a taskbar jump list of recent pages.'),
  flag('qol.onenoteKeys', 'The OneNote shortcut set offered in setup.'),
  flag('qol.conflicts', 'A banner and a side-by-side view for copies made by sync tools.'),
  flag('qol.a11yCheck', 'Check accessibility of a page or section, with a fix for each problem.'),
];
