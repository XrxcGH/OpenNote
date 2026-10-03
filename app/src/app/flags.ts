// Feature flags (ARCHITECTURE.md sections 2.2 and 7.2). Unfinished features stay behind a flag, and items whose
// feature isn't ready are hidden, never shown disabled. The channel comes from the boot payload. Development and
// nightly builds also take overrides from the boot payload and from settings.experimental.flags.

import type { Channel } from '../platform/bindings/Channel';
import { INK_FLAGS } from '../features/ink/flags';
import { PAGE_FLAGS } from '../features/page/flags';
import { createStore, useStore } from '../state/store';

export type { Channel } from '../platform/bindings/Channel';

export type FlagId =
  | 'window.snapLayouts'
  | 'install.uninstallEntry'
  | 'updates.meteredCheck'
  | 'updates.resume'
  | 'updates.betaChannel'
  | 'notes.sectionGroups'
  | 'trash.view'
  | 'notes.memorySnapshot'
  | 'commandBar.insert'
  | 'commandBar.draw'
  | 'setup.smartFeatures'
  | 'setup.import'
  | 'settings.penAndInk'
  | 'settings.recording'
  | 'settings.privacyAndAi'
  | 'bottomBar.recent'
  /** Phase 3's switch to the storage-backed notes service. */
  | 'storage.core'
  | Phase4FlagId
  | Phase5FlagId;

/**
 * Flags the Phase 4 and Phase 5 designs name (AMENDMENTS.md P2-1). Each phase adds its FLAGS entries when it
 * builds the feature; until then they are off everywhere.
 */
type Phase4FlagId =
  | 'page.editor'
  | 'page.images'
  | 'page.tables'
  | 'page.codeHighlight'
  | 'page.slashMenu'
  | 'page.styles'
  | 'page.outline'
  | 'page.typingHelpers'
  | 'page.pasteExtras'
  | 'page.formattingBar'
  | 'page.readingOrder'
  | 'page.history'
  | 'page.imageRenditions'
  | 'page.heicImport'
  | 'editor.spelling'
  | 'editor.readAloud';

type Phase5FlagId =
  | 'ink.core'
  | 'ink.erasers'
  | 'ink.lasso'
  | 'ink.palm'
  | 'ink.shapes'
  | 'ink.anchoring'
  | 'ink.insertSpace'
  | 'ink.zoomBox'
  | 'ink.gestures'
  | 'ink.penButtons'
  | 'ink.steadyPen'
  | 'ink.describe'
  | 'ink.delegatedTrail'
  | 'ink.nativeTrail'
  | 'ink.openSnapshot'
  | 'dev.penRecorder';

export interface FlagDef {
  id: FlagId;
  /** For the About section in development and nightly builds. */
  description: string;
  /** The tracking issue, or a search for the flag's issues until one exists. */
  issue: string;
  enabled: Record<Channel, boolean>;
}

export function defineFlag(def: FlagDef): FlagDef {
  return def;
}

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const off = { dev: false, nightly: false, beta: false, stable: false };
const on = { dev: true, nightly: true, beta: true, stable: true };
const testBuilds = { dev: true, nightly: true, beta: false, stable: false };

const flag = (id: FlagId, description: string, enabled: Record<Channel, boolean>) =>
  defineFlag({ id, description, issue: `${ISSUES}${encodeURIComponent(id)}`, enabled });

export const FLAGS: readonly FlagDef[] = [
  flag('window.snapLayouts', 'The Snap Layouts flyout on the Maximize button, if the spike passes.', off),
  flag('install.uninstallEntry', 'A per-user entry in Installed apps.', off),
  flag('updates.meteredCheck', 'Wait for an unmetered network before downloading an update.', off),
  flag('updates.resume', 'Resume a download that stopped partway.', off),
  flag('updates.betaChannel', 'The Stable or Beta choice in Settings.', off),
  flag('notes.sectionGroups', 'Section groups in notebooks.', on),
  flag('trash.view', 'The Trash view with Restore.', testBuilds),
  flag('notes.memorySnapshot', 'Keep the Phase 2 notes in a temporary snapshot file.', testBuilds),
  flag('commandBar.insert', 'The Insert tab of the command bar.', off),
  flag('commandBar.draw', 'The Draw tab of the command bar.', on),
  flag('setup.smartFeatures', 'The smart features step of setup.', off),
  flag('setup.import', 'The step of setup that brings in notes from other apps.', off),
  flag('settings.penAndInk', 'The Pen and ink section of Settings.', off),
  flag('settings.recording', 'The Recording section of Settings.', off),
  flag('settings.privacyAndAi', 'The Privacy and smart features section of Settings.', off),
  flag('bottomBar.recent', 'Recent pages in the compact bottom bar.', off),
  flag('storage.core', "Phase 3's storage-backed notes service.", off),
  ...PAGE_FLAGS,
  ...INK_FLAGS,
];

interface FlagState {
  channel: Channel;
  overrides: Readonly<Record<string, boolean | undefined>>;
}

const flagStore = createStore<FlagState>({ channel: 'dev', overrides: {} }, 'flags');
const byId = new Map(FLAGS.map((def) => [def.id, def]));

/** Sets the channel and the overrides. Overrides apply only in development and nightly builds. */
export function initFlags(
  channel: Channel,
  ...overrides: readonly Readonly<Record<string, boolean | undefined>>[]
): void {
  const allowed = channel === 'dev' || channel === 'nightly';
  flagStore.set({ channel, overrides: allowed ? Object.assign({}, ...overrides) : {} });
}

function enabledIn(state: FlagState, id: FlagId): boolean {
  const override = state.overrides[id];
  if (typeof override === 'boolean') return override;
  return byId.get(id)?.enabled[state.channel] ?? false;
}

/** The channel default, then the overrides. */
export function isEnabled(id: FlagId): boolean {
  return enabledIn(flagStore.get(), id);
}

export function useFlag(id: FlagId): boolean {
  return useStore(flagStore, (state) => enabledIn(state, id));
}

/** Registry items with a flag that is off are skipped (ARCHITECTURE.md section 7.2). */
export function withEnabledFlags<T extends { readonly flag?: FlagId }>(items: readonly T[]): T[] {
  return items.filter((item) => item.flag === undefined || isEnabled(item.flag));
}
