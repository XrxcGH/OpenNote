// Feature flags (ARCHITECTURE.md sections 2.2 and 7.2). Unfinished features stay behind a flag, and items whose
// feature isn't ready are hidden, never shown disabled. The channel comes from the boot payload. Development and
// nightly builds also take overrides from the boot payload and from settings.experimental.flags.

import type { Channel } from '../platform/bindings/Channel';
import { INK_FLAGS } from '../features/ink/flags';
import { PAGE_FLAGS } from '../features/page/flags';
import type { QolPageFlagId } from '../features/page/flags';
import { PAGES_FLAGS } from '../features/pages/flags';
import { AUDIO_FLAGS } from '../features/audio/flags';
import { INTEROP_FLAGS } from '../features/interop/flags';
import { INTEGRATIONS_FLAGS } from '../features/integrations/flags';
import type { IntegrationsFlagId } from '../features/integrations/flags';
import { INTEL_FLAGS } from '../features/intel/flags';
import { DIAGNOSTICS_FLAGS } from '../features/diagnostics/flags';
import { CONNECTORS_FLAGS } from '../features/connectors/flags';
import { EXPR_FLAGS } from '../features/tools/flags';
import { SEARCH_FLAGS } from '../features/search/flags';
import { QOL_FLAGS } from '../features/qol/flags';
import { createStore, useStore } from '../state/store';

export type { Channel } from '../platform/bindings/Channel';

export type FlagId =
  | 'window.snapLayouts'
  /** The undecorated window with the HTML title bar and caption buttons (ARCHITECTURE.md section 10). */
  | 'shell.customFrame'
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
  | 'settings.recording'
  | 'bottomBar.recent'
  /** Notes kept on disk in every build: the library file and the core's pages in the notes folder. */
  | 'storage.core'
  /** Phase 11: import from other apps, and export to files. */
  | 'interop.import'
  | 'interop.export'
  | 'interop.exportPdf'
  | Phase4FlagId
  | QolPageFlagId
  | Phase5FlagId
  | Phase6FlagId
  | ExprFlagId
  | Phase8FlagId
  | Phase9FlagId
  | IntelFlagId
  | Phase13FlagId
  | QolFlagId
  /** The Connectors section of Settings (features/connectors/flags.ts). */
  | 'connectors.page';

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
  | 'editor.readAloud'
  | IntegrationsFlagId;

/** Phase 6: page views and export (features/pages/flags.ts). */
type Phase6FlagId =
  | 'pages.view'
  | 'pages.pdf'
  | 'pages.exportText'
  | 'pages.exportImage'
  | 'pages.gallery'
  | 'pages.slides'
  | 'pages.reading'
  | 'pages.layouts'
  | 'pages.sheets'
  | 'pages.accessiblePdf'
  | 'pages.elements'
  | 'pages.exportSelection'
  | 'pages.laser'
  | 'pages.syllables';
/** Smart tables, charts, math, and the study tool windows (Phases 7 and 10). */
type ExprFlagId =
  'tables.smart' | 'tables.charts' | 'math.latex' | 'math.grapher' | 'math.actions' | 'tools.windows' | ToolsQolFlagId;
/** The quality-of-life flags of the tables, math, study, and tools lane (features/tools/flags.ts). */
type ToolsQolFlagId =
  | 'tables.calculated'
  | 'tables.views'
  | 'tables.chartTable'
  | 'math.quickMath'
  | 'math.notes'
  | 'math.diagrams'
  | 'math.mindMaps'
  | 'study.cards'
  | 'study.import'
  | 'study.tape'
  | 'tools.converter'
  | 'tools.reference'
  | 'tools.dictionary'
  | 'tools.exams'
  | 'tools.timetable'
  | 'tools.dueDates'
  | 'tools.reminders'
  | 'tools.citations';
/** Phase 8's flags: search, links, linked pages, and tags. Their definitions are in features/search/flags.ts. */
type Phase8FlagId =
  'search.panel' | 'search.switcher' | 'search.links' | 'search.backlinks' | 'search.tags' | QolSearchFlagId;
/** The Beta 4 search and linking additions, which features/search/flags.ts defines. */
type QolSearchFlagId =
  | 'search.lineTags'
  | 'search.paragraphLinks'
  | 'search.properties'
  | 'search.replace'
  | 'search.indexMedia'
  | 'daily.notes'
  | 'collections.views'
  | 'graph.view'
  | 'canvas.cards';
/** Phase 12's flags, which features/intel/flags.ts defines. */
type IntelFlagId =
  | 'intel.ocr'
  | 'intel.readAloud'
  | 'intel.summaries'
  | 'intel.handwriting'
  | 'intel.searchText'
  | 'intel.models'
  | 'intel.vocabulary'
  | 'intel.background'
  | 'intel.backgroundOcr'
  | 'intel.handwritingExtras'
  | 'intel.meaning'
  | 'intel.ask'
  | 'intel.writing';

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
  | 'ink.hover'
  | 'ink.canvasLock'
  | 'ink.snapTools'
  | 'ink.replay'
  | 'ink.shapeTools'
  | 'ink.handwriting'
  | 'ink.gridTable'
  | 'ink.penEditing';

/** Phase 9's flags; features/audio/flags.ts defines them. */
type Phase9FlagId =
  | 'audio.record'
  | 'audio.stamps'
  | 'audio.flags'
  | 'audio.trim'
  | 'audio.systemAudio'
  | 'audio.meetingPrompt'
  | 'audio.enhance'
  | 'audio.storage'
  | 'audio.snap'
  | 'audio.import'
  | 'audio.export'
  | 'transcripts.block'
  | 'transcripts.speakers'
  | 'transcripts.notes'
  | 'transcripts.actions'
  | 'transcripts.recap';
/** Phase 13: the Privacy panel, Work offline, crash reports, the self-check, feedback, and safe start. */
type Phase13FlagId =
  | 'privacy.panel'
  | 'privacy.workOffline'
  | 'diagnostics.crashReports'
  | 'diagnostics.selfCheck'
  | 'diagnostics.feedback'
  | 'diagnostics.safeStart';

/** The shell and storage quality-of-life features; features/qol/flags.ts defines them. */
type QolFlagId =
  | 'qol.multiSelect'
  | 'qol.pins'
  | 'qol.tabs'
  | 'qol.recentlyClosed'
  | 'qol.dock'
  | 'qol.scheduledBackups'
  | 'qol.externalEdits'
  | 'qol.cloudFolders'
  | 'qol.openFolder'
  | 'qol.checkNotebook'
  | 'qol.quickCapture'
  | 'qol.focusMode'
  | 'qol.miniWindow'
  | 'qol.lowPower'
  | 'qol.archive'
  | 'qol.home'
  | 'qol.shortcuts'
  | 'qol.onenoteKeys'
  | 'qol.conflicts'
  | 'qol.a11yCheck';

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
const betaBuilds = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: FlagId, description: string, enabled: Record<Channel, boolean>) =>
  defineFlag({ id, description, issue: `${ISSUES}${encodeURIComponent(id)}`, enabled });

export const FLAGS: readonly FlagDef[] = [
  flag('window.snapLayouts', 'The Snap Layouts flyout on the Maximize button, if the spike passes.', betaBuilds),
  flag(
    'shell.customFrame',
    'The custom title bar with its own caption buttons, instead of the native frame.',
    betaBuilds,
  ),
  flag('install.uninstallEntry', 'A per-user entry in Installed apps.', off),
  flag('updates.meteredCheck', 'Wait for an unmetered network before downloading an update.', off),
  flag('updates.resume', 'Resume a download that stopped partway.', off),
  flag('updates.betaChannel', 'The Stable or Beta choice in Settings.', betaBuilds),
  flag('notes.sectionGroups', 'Section groups in notebooks.', on),
  flag('trash.view', 'The Trash view with Restore.', betaBuilds),
  flag('notes.memorySnapshot', 'Keep the Phase 2 notes in a temporary snapshot file.', testBuilds),
  flag('commandBar.insert', 'The Insert tab of the command bar.', betaBuilds),
  flag('commandBar.draw', 'The Draw tab of the command bar.', on),
  flag('setup.smartFeatures', 'The smart features step of setup.', betaBuilds),
  flag('setup.import', 'The step of setup that brings in notes from other apps.', on),
  flag('settings.recording', 'The Recording section of Settings.', on),
  flag('bottomBar.recent', 'Recent pages in the compact bottom bar.', betaBuilds),
  flag('storage.core', 'Keep notes on disk: notebook folders in the notes folder, through the core.', on),
  ...PAGE_FLAGS,
  ...INK_FLAGS,
  ...PAGES_FLAGS,
  ...EXPR_FLAGS,
  ...SEARCH_FLAGS,
  ...AUDIO_FLAGS,
  ...INTEROP_FLAGS,
  ...INTEGRATIONS_FLAGS,
  ...INTEL_FLAGS,
  ...DIAGNOSTICS_FLAGS,
  ...QOL_FLAGS,
  ...CONNECTORS_FLAGS,
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
