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
import { PDF_FLAGS } from '../features/pdf/flags';
import type { PdfFlagId } from '../features/pdf/flags';
import { MATH_TOOLS_FLAGS } from '../features/math/flags';
import type { MathToolsFlagId } from '../features/math/flags';
import { INTEL_FLAGS } from '../features/intel/flags';
import { DIAGNOSTICS_FLAGS } from '../features/diagnostics/flags';
import { ACCOUNTS_FLAGS } from '../features/accounts/flags';
import { CONNECTORS_FLAGS } from '../features/connectors/flags';
import { CHEMMAT_FLAGS, EXPR_FLAGS, LIFESYS_FLAGS, MIND_FLAGS } from '../features/tools/flags';
import type { ChemMatFlagId, LifeSysFlagId, MindFlagId } from '../features/tools/flags';
import { DOC_FLAGS } from '../features/docstructure/flags';
import type { DocFlagId } from '../features/docstructure/flags';
import { SEARCH_FLAGS } from '../features/search/flags';
import { QOL_FLAGS } from '../features/qol/flags';
import { PROTECT_FLAGS } from '../features/protect/flags';
import type { ProtectFlagId } from '../features/protect/flags';
import { ENGINEERING_FLAGS } from '../features/engineering/flags';
import { SYNC_FLAGS } from '../features/sync/flags';
import type { EngineeringFlagId } from '../features/engineering/flags';
import { STATMODELS_FLAGS } from '../features/tools/flags';
import type { StatModelsFlagId } from '../features/tools/flags';
import { MOLBIO_FLAGS } from '../features/tools/flags';
import type { MolBioFlagId } from '../features/tools/flags';
import { CIVIL_FLAGS } from '../features/tools/flags';
import type { CivilFlagId } from '../features/tools/flags';
import { MODPHYS_FLAGS } from '../features/tools/flags';
import type { ModPhysFlagId } from '../features/tools/flags';
import { TUTOR_FLAGS } from '../features/tutor/flags';
import type { TutorFlagId } from '../features/tutor/flags';
import { DESIGN_KIT_FLAGS } from '../features/tools/flags';
import type { DesignKitFlagId } from '../features/tools/flags';
import { KIT_FLAGS } from '../features/tools/flags';
import type { KitFlagId } from '../features/tools/flags';
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
  | 'setup.language'
  | 'settings.recording'
  | 'bottomBar.recent'
  /** Notes kept on disk in every build: the library file and the core's pages in the notes folder. */
  | 'storage.core'
  /** Phase 11: import from other apps, and export to files. */
  | 'interop.import'
  | 'interop.export'
  | 'interop.exportPdf'
  | 'interop.latexExport'
  | 'interop.oneNoteFiles'
  /** Goodnotes, Notability, and Samsung Notes files (ADR 0053). */
  | 'interop.notesApps'
  /** Import of older and binary office files: .doc, .rtf, .xls, .xlsb, and .ods. */
  | 'interop.legacyFormats'
  | Phase4FlagId
  | QolPageFlagId
  | Phase5FlagId
  | Phase6FlagId
  | ExprFlagId
  | 'kits.math'
  | DocFlagId
  | Phase8FlagId
  | Phase9FlagId
  | IntelFlagId
  | Phase13FlagId
  | QolFlagId
  | ProtectFlagId
  | EngineeringFlagId
  | StatModelsFlagId
  | MindFlagId
  | MolBioFlagId
  | LifeSysFlagId
  | CivilFlagId
  | ModPhysFlagId
  | DesignKitFlagId
  /** The tool kits' shared live calculation block (features/tools/kits/flags.ts). */
  | KitFlagId
  /** The Connectors section of Settings (features/connectors/flags.ts). */
  | 'connectors.page'
  /** Optional end-to-end-encrypted sync, Settings > Sync (features/sync/flags.ts). */
  | 'sync.e2ee'
  /** The account and media features (features/accounts/flags.ts). */
  | AccountsFlagId
  /** The tutor (features/tutor/flags.ts). */
  | TutorFlagId
  /** The physics tool kit window (features/tools/physics). */
  | 'kits.physics';

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
  | IntegrationsFlagId
  | PdfFlagId
  | MathToolsFlagId
  | ChemMatFlagId;

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
  | 'pages.realPrint'
  | 'pages.elements'
  | 'pages.exportSelection'
  | 'pages.laser'
  | 'pages.slideMarks'
  | 'pages.exportPlayer'
  | 'pages.exportUpdate'
  | 'pages.syllables';
/** Smart tables, charts, math, and the study tool windows (Phases 7 and 10). */
type ExprFlagId =
  'tables.smart' | 'tables.charts' | 'math.latex' | 'math.grapher' | 'math.actions' | 'tools.windows' | ToolsQolFlagId;
/** The quality-of-life flags of the tables, math, study, and tools lane (features/tools/flags.ts). */
type ToolsQolFlagId =
  | 'tables.calculated'
  | 'tables.views'
  | 'tables.savedViews'
  | 'tables.choice'
  | 'tables.analysis'
  | 'tables.chartTable'
  | 'math.quickMath'
  | 'math.notes'
  | 'math.diagrams'
  | 'math.codeCells'
  | 'math.mindmapExport'
  | 'math.mindmapPen'
  | 'math.mindMaps'
  | 'study.cards'
  | 'study.import'
  | 'study.tape'
  | 'study.tapeBlanks'
  | 'study.exams'
  | 'tools.converter'
  | 'tools.reference'
  | 'tools.dictionary'
  | 'tools.symbols'
  | 'tools.exams'
  | 'tools.timetable'
  | 'tools.dueDates'
  | 'tools.reminders'
  | 'tools.citations'
  | 'tools.zotero'
  | 'tools.constants'
  | 'tools.sigfigs'
  | 'math.latexInsert'
  | 'tools.chemCalc'
  | 'tools.structure'
  | 'tools.properties'
  | 'tools.econ';
/** Phase 8's flags: search, links, linked pages, and tags. Their definitions are in features/search/flags.ts. */
type Phase8FlagId =
  'search.panel' | 'search.switcher' | 'search.links' | 'search.backlinks' | 'search.tags' | QolSearchFlagId;
/** The Beta 4 search and linking additions, which features/search/flags.ts defines. */
type QolSearchFlagId =
  | 'search.lineTags'
  | 'search.paragraphLinks'
  | 'search.properties'
  | 'search.replace'
  | 'search.changeSets'
  | 'search.linkAll'
  | 'search.advanced'
  | 'search.indexMedia'
  | 'daily.notes'
  | 'collections.views'
  | 'collections.block'
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
  | 'intel.writing'
  | 'intel.transcription'
  | 'intel.autoTranscripts'
  | 'intel.cloudKeys'
  | 'math.visualEditor'
  | 'intel.speakers'
  | 'intel.dictation'
  | 'intel.liveCaptions'
  | 'intel.mathInk'
  | 'intel.translate';

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
  | 'ink.geometry'
  | 'ink.paperSnap'
  | 'ink.replay'
  | 'ink.shapeTools'
  | 'ink.splines'
  | 'ink.handwriting'
  | 'ink.gridTable'
  | 'ink.penEditing'
  | 'ink.groups'
  | 'ink.penLibrary'
  | 'ink.links'
  | 'ink.layers'
  | 'ink.penFields'
  | 'ink.myHandwriting'
  | 'ink.delegatedTrail'
  | 'dev.penRecorder';

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
  | 'qol.a11yCheck'
  | 'qol.a11yGate';

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
const on = { dev: true, nightly: true, beta: true, stable: true };
const testBuilds = { dev: true, nightly: true, beta: false, stable: false };
/** The flags the shell reads too (platform_flags.rs): on up to Beta, off in Stable. */
const betaBuilds = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: FlagId, description: string, enabled: Record<Channel, boolean>) =>
  defineFlag({ id, description, issue: `${ISSUES}${encodeURIComponent(id)}`, enabled });

export const FLAGS: readonly FlagDef[] = [
  flag('window.snapLayouts', 'The Snap Layouts flyout on the Maximize button, if the spike passes.', on),
  flag('shell.customFrame', 'The custom title bar with its own caption buttons, instead of the native frame.', on),
  flag('install.uninstallEntry', 'A per-user entry in Installed apps, and OpenNote.exe --uninstall.', betaBuilds),
  flag('updates.meteredCheck', 'Wait for an unmetered network before downloading an update.', betaBuilds),
  flag('updates.resume', 'Resume a download that stopped partway.', betaBuilds),
  flag('updates.betaChannel', 'The Stable or Beta choice in Settings.', on),
  flag('notes.sectionGroups', 'Section groups in notebooks.', on),
  flag('trash.view', 'The Trash view with Restore.', on),
  flag('notes.memorySnapshot', 'Keep the Phase 2 notes in a temporary snapshot file.', testBuilds),
  flag('commandBar.insert', 'The Insert tab of the command bar.', on),
  flag('commandBar.draw', 'The Draw tab of the command bar.', on),
  flag('setup.smartFeatures', 'The smart features step of setup.', on),
  flag('setup.import', 'The step of setup that brings in notes from other apps.', on),
  flag('setup.language', 'The Language and spelling step of setup.', on),
  flag('settings.recording', 'The Recording section of Settings.', on),
  flag('bottomBar.recent', 'Recent pages in the compact bottom bar.', on),
  flag('storage.core', 'Keep notes on disk: notebook folders in the notes folder, through the core.', on),
  flag(
    'kits.physics',
    'The physics tools: fields, waves, optics, relativity, nuclear, orbits, and spacecraft.',
    betaBuilds,
  ),
  ...PAGE_FLAGS,
  ...INK_FLAGS,
  ...PAGES_FLAGS,
  ...EXPR_FLAGS,
  ...CHEMMAT_FLAGS,
  ...DOC_FLAGS,
  ...SEARCH_FLAGS,
  ...AUDIO_FLAGS,
  ...INTEROP_FLAGS,
  ...INTEGRATIONS_FLAGS,
  ...PDF_FLAGS,
  ...MATH_TOOLS_FLAGS,
  ...INTEL_FLAGS,
  ...DIAGNOSTICS_FLAGS,
  ...QOL_FLAGS,
  ...PROTECT_FLAGS,
  ...CONNECTORS_FLAGS,
  ...ACCOUNTS_FLAGS,
  ...ENGINEERING_FLAGS,
  ...STATMODELS_FLAGS,
  ...MIND_FLAGS,
  ...MOLBIO_FLAGS,
  ...LIFESYS_FLAGS,
  ...CIVIL_FLAGS,
  ...MODPHYS_FLAGS,
  ...TUTOR_FLAGS,
  ...SYNC_FLAGS,
  ...DESIGN_KIT_FLAGS,
  ...KIT_FLAGS,
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

/** The flags of the account and media features; features/accounts/flags.ts defines them. */
type AccountsFlagId =
  | 'accounts.readwise'
  | 'accounts.meetings'
  | 'accounts.share'
  | 'accounts.lms'
  | 'accounts.sendTo'
  | 'accounts.googleOffice'
  | 'accounts.onenoteGraph'
  | 'accounts.tasksSync'
  | 'accounts.cloudSync'
  | 'accounts.penSync'
  | 'accounts.youtubeUpload'
  | 'accounts.captions'
  | 'page.mediaEmbeds'
  | 'page.liveEmbeds'
  | 'page.localVideo'
  | 'audio.exportVideo';
