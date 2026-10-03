// The one interface between the interface code and the host (ARCHITECTURE.md section 6.1).
// platform/tauri implements it over Tauri commands and events. platform/web implements it with in-memory fakes,
// so the whole interface also runs in a plain browser for development and tests.

import type { NotesCoreClient } from '../services/notes/core/service';
import type { AudioHost, RecordingEntry } from '../core/audio';
import type { DiagnosticsClient } from '../features/diagnostics';
import type { ImportedAsset, PageService } from '../services/pages/types';
import type { SearchClient } from '../services/search/types';
import type { MessageKey } from '../strings/t';
import type { InteropClient } from './interop';
import type { BootData } from './bindings/BootData';
import type { CaptionLayout } from './bindings/CaptionLayout';
import type { CaptionState } from './bindings/CaptionState';
import type { DeviceState } from './bindings/DeviceState';
import type { ExitReason } from './bindings/ExitReason';
import type { ExternalTarget } from './bindings/ExternalTarget';
import type { FolderCheck } from './bindings/FolderCheck';
import type { InstallStatus } from './bindings/InstallStatus';
import type { LogLevel } from './bindings/LogLevel';
import type { OsAppearance } from './bindings/OsAppearance';
import type { PerfMark } from './bindings/PerfMark';
import type { Point } from './bindings/Point';
import type { ReadyTimings } from './bindings/ReadyTimings';
import type { Settings } from './bindings/Settings';
import type { SettingsSectionKey } from './bindings/SettingsSectionKey';
import type { ThemeName } from './bindings/ThemeName';
import type { UpdaterStatus } from './bindings/UpdaterStatus';

export type { Architecture } from './bindings/Architecture';
export type { BootData } from './bindings/BootData';
export type { CaptionLayout } from './bindings/CaptionLayout';
export type { CaptionState } from './bindings/CaptionState';
export type { Channel } from './bindings/Channel';
export type { DeviceState } from './bindings/DeviceState';
export type { ExitReason } from './bindings/ExitReason';
export type { ExternalTarget } from './bindings/ExternalTarget';
export type { FolderCheck } from './bindings/FolderCheck';
export type { InstallStatus } from './bindings/InstallStatus';
export type { IpcError } from './bindings/IpcError';
export type { KeymapPreset } from './bindings/KeymapPreset';
/** The shortcut set that settings.shortcuts overrides apply on top of. */
export type { KeymapPreset as KeymapPresetId } from './bindings/KeymapPreset';
export type { LogLevel } from './bindings/LogLevel';
export type { Notice } from './bindings/Notice';
export type { OsAppearance } from './bindings/OsAppearance';
export type { PanePref } from './bindings/PanePref';
export type { PerfMark } from './bindings/PerfMark';
export type { Point } from './bindings/Point';
export type { ReadyTimings } from './bindings/ReadyTimings';
export type { Rect } from './bindings/Rect';
export type { Settings } from './bindings/Settings';
export type { SettingsSectionKey } from './bindings/SettingsSectionKey';
export type { StoredLocation } from './bindings/StoredLocation';
export type { TextSize } from './bindings/TextSize';
export type { ThemeName } from './bindings/ThemeName';
export type { ThemePreference } from './bindings/ThemePreference';
export type { UpdaterPhase } from './bindings/UpdaterPhase';
export type { UpdaterStatus } from './bindings/UpdaterStatus';
export type { WindowPlacement } from './bindings/WindowPlacement';

export type Unsubscribe = () => void;

export type { SearchClient };

/** An RFC 7396 merge patch: every key optional, objects patched recursively, and null removes a key. */
export type MergePatch<T> = {
  [K in keyof T]?: (T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? MergePatch<T[K]> : T[K]) | null;
};
export type SettingsPatch = MergePatch<Settings>;
/** Rust owns the window placement. */
export type DeviceStatePatch = MergePatch<Omit<DeviceState, 'window'>>;

/** What a beforeExit hook answers. A refusal keeps the window open and says why. */
export type ExitResult = { ok: true } | { ok: false; reason: MessageKey };

export interface Platform {
  readonly kind: 'tauri' | 'web';
  readonly boot: BootData;
  readonly settings: SettingsClient;
  readonly state: DeviceStateClient;
  readonly os: OsClient;
  readonly window: WindowClient;
  readonly lifecycle: LifecycleClient;
  readonly install: InstallClient;
  readonly updater: UpdaterClient;
  readonly shell: ShellClient;
  readonly pages: PagesClient;
  /** Search and linking over the index (Phase 8). */
  readonly search: SearchClient;
  /** Phase 13: crash reports, the self-check, the feedback file, safe start, and Work offline. */
  readonly diagnostics: DiagnosticsClient;
  readonly spelling: SpellingClient;
  readonly clipboard: ClipboardClient;
  readonly images: ImagesClient;
  readonly exports: ExportsClient;
  /** Phase 9: recording and playback. */
  readonly audio: AudioClient;
  /** Null unless the read-aloud fallback is built. */
  readonly speech: SpeechClient | null;
  /** Phase 11: import and export. */
  readonly interop: InteropClient;
  /** Phase 2 only, behind notes.memorySnapshot. */
  readonly notesSnapshot: NotesSnapshotClient | null;
  /** The notes bridge over the core, which keeps the tree in the notes folder. Null on the web platform. */
  readonly notesCore: NotesCoreClient | null;
  readonly perf: PerfClient;
  log(level: LogLevel, message: string): void;
}

/** Phase 9's audio client: the media crate's commands, and the folder that keeps a page's recordings. */
export interface AudioClient {
  readonly host: AudioHost;
  /**
   * The host keeps each track in the page's own folder as an asset of the page, so the page's table must list it
   * (`addAsset` when a track is made or changes, `removeAsset` when an edit replaces it). The fake host keeps no
   * files, so the page has nothing to list.
   */
  readonly keepsAssets: boolean;
  /** The folder of a page's recordings, which the host's start, recover, and playback commands take. */
  assetsDir(page: string): Promise<string>;
  /**
   * Hands the open page the tracks of an entry, read from the files in its folder as they are now. The flag
   * `growing` says the files are still being written. The `addAsset` edits that follow put the tracks in the
   * page's table.
   */
  adoptTracks(assetsDir: string, entry: RecordingEntry, growing: boolean): Promise<void>;
  /** Trims the silence at both ends, or answers null when there is none worth trimming. */
  trimSilence(assetsDir: string, entry: RecordingEntry): Promise<AudioEdit | null>;
  /** Removes the audio between two positions, in nanoseconds. */
  removePart(assetsDir: string, entry: RecordingEntry, startNs: number, endNs: number): Promise<AudioEdit>;
  /** Deletes the files of a recording the page no longer lists. Answers with the bytes freed. */
  deleteFiles(assetsDir: string, entry: RecordingEntry): Promise<number>;
}

/** A recording after an edit: the entry that takes the old one's place, and its new length. */
export interface AudioEdit {
  entry: RecordingEntry;
  durationNs: number;
}

export interface SettingsClient {
  /** An RFC 7396 merge patch. Rejects with an IpcError, and changes nothing, when a field is invalid. */
  update(patch: SettingsPatch): Promise<Settings>;
  reset(section: SettingsSectionKey): Promise<Settings>;
  onChange(listener: (settings: Settings, origin: string) => void): Unsubscribe;
}

export interface DeviceStateClient {
  /** Rust debounces writes by 500 ms. */
  update(patch: DeviceStatePatch): void;
  flush(): Promise<void>;
}

export interface OsClient {
  current(): OsAppearance;
  onChange(listener: (os: OsAppearance) => void): Unsubscribe;
}

export interface WindowClient {
  minimize(): void;
  toggleMaximize(): void;
  /** Goes through the exit handshake. */
  close(): void;
  isMaximized(): boolean;
  onMaximizedChange(listener: (maximized: boolean) => void): Unsubscribe;
  setTitle(title: string): void;
  /** ARCHITECTURE.md section 10.4. */
  setCaptionLayout(layout: CaptionLayout | null): void;
  onCaptionState(listener: (state: CaptionState) => void): Unsubscribe;
  showSystemMenu(at: Point | null): void;
  /** DWM frame colors, never WebView2's color scheme. */
  setFrameTheme(theme: ThemeName): void;
  onForwardedArgs(listener: (args: string[]) => void): Unsubscribe;
}

export interface LifecycleClient {
  /** Shows the window under the hidden strategy. */
  firstPaint(): void;
  /** The last page is on screen. */
  ready(timings: ReadyTimings): void;
  onBeforeExit(listener: (reason: ExitReason) => void): Unsubscribe;
  exitReady(result: ExitResult): void;
}

export interface InstallClient {
  status(): Promise<InstallStatus>;
  pickNotesFolder(initial: string | null): Promise<string | null>;
  checkNotesFolder(path: string): Promise<FolderCheck>;
  /** Relaunches from the new place on success. */
  moveToUserPrograms(): Promise<void>;
}

export interface UpdaterClient {
  status(): UpdaterStatus;
  onStatus(listener: (status: UpdaterStatus) => void): Unsubscribe;
  check(): Promise<void>;
  download(): Promise<void>;
  restartToUpdate(): Promise<void>;
  skip(version: string): Promise<void>;
  unskip(): Promise<void>;
  goBack(): Promise<void>;
}

export interface ShellClient {
  /** Allowlisted targets, never a raw URL. */
  openExternal(target: ExternalTarget): Promise<void>;
}

export interface NotesSnapshotClient {
  load(): Promise<string | null>;
  /** Rust writes atomically, with a 5 MB cap. */
  save(json: string): Promise<void>;
}

export interface PerfClient {
  /** Does nothing unless OPENNOTE_PERF_LOG is set. `detail` says more, such as the theme the first frame painted. */
  mark(name: PerfMark, detail?: string): void;
}

// The clients of Phase 4 (PLAN.md section 3.12, P2-10). Each has one file per platform: platform/tauri/<client>.ts
// calls the shell's commands, and platform/web/<client>.ts is an in-memory fake. A phase that needs more methods
// adds them here, with a fake and a wrapper, and keeps the existing ones.

/** Pages through Phase 3's core: open a page, then edit it through the OpenPage (WP2). */
export type PagesClient = PageService;

/** The Windows Spell Checking API in the shell (WP7). Ranges are in UTF-16 units. */
export interface SpellingClient {
  languages(): Promise<{ tag: string; name: string; isDefault: boolean }[]>;
  check(
    items: readonly { id: string; text: string }[],
    languages: readonly string[],
  ): Promise<{ id: string; errors: { start: number; length: number }[] }[]>;
  suggest(word: string, languages: readonly string[]): Promise<string[]>;
  addWord(word: string): Promise<void>;
  removeWord(word: string): Promise<void>;
}

/** What the clipboard holds besides what the browser's paste event gives (WP5). */
export interface ClipboardFacts {
  sequence: number;
  textSha256: string | null;
  sourceUrl: string | null;
  hasOneNote: boolean;
  wordImages: { src: string; token: string }[];
}
export interface ClipboardContent extends ClipboardFacts {
  html: string | null;
  text: string | null;
  imageBmp: ArrayBuffer | null;
}
export interface ClipboardClient {
  facts(): Promise<ClipboardFacts>;
  read(): Promise<ClipboardContent>;
}

/** Image import: the shell probes each image and stores it as an asset of the page (WP5). */
export interface ImagesClient {
  importBytes(page: string, bytes: ArrayBuffer, name: string, mime: string): Promise<ImportedAsset>;
  importUrl(page: string, url: string): Promise<ImportedAsset>;
  importClip(page: string, token: string): Promise<ImportedAsset>;
}

/** Local voices for read aloud, only if the Web Speech fallback is built (WP7). */
/**
 * Printing a page to PDF and saving what an export makes (Phase 6, ADR 0006). The desktop app prints in a hidden
 * WebView2 window; the web platform's fake prints nothing and writes a stand-in file, so the interface runs in tests.
 */
export interface ExportsClient {
  /** Opens the hidden print window on a `PrepareInput` (as JSON) and returns the `PrepareResult` it planned. */
  printPrepare(job: string, input: unknown): Promise<unknown>;
  /** Prints the window's document to PDF. The size is the first sheet's box in inches. */
  printRender(job: string, size: { width: number; height: number }, background: boolean): Promise<Uint8Array>;
  printClose(job: string): Promise<void>;
  /** Shows the Save dialog. Resolves to the chosen path, or null when the person cancels. */
  pickSave(request: { suggested: string; label: string; extension: string }): Promise<string | null>;
  /** Writes the file at a chosen path and any files beside it (paths relative to its folder). */
  write(path: string, files: readonly { path: string; bytes: Uint8Array }[]): Promise<void>;
  /** Opens a file this session exported in its default app, or shows it in File Explorer. */
  open(path: string, reveal: boolean): Promise<void>;
}

/** Local voices for read aloud, only if the Web Speech fallback is built (WP7). */
export interface SpeechClient {
  voices(): Promise<{ id: string; name: string; language: string }[]>;
  synthesize(
    text: string,
    voice: string,
  ): Promise<{ wav: ArrayBuffer; boundaries: { ms: number; start: number; length: number }[] }>;
}
