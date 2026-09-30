// The one interface between the interface code and the host (ARCHITECTURE.md section 6.1).
// platform/tauri implements it over Tauri commands and events. platform/web implements it with in-memory fakes,
// so the whole interface also runs in a plain browser for development and tests.

import type { MessageKey } from '../strings/t';
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
  /** Phase 2 only, behind notes.memorySnapshot. */
  readonly notesSnapshot: NotesSnapshotClient | null;
  readonly perf: PerfClient;
  log(level: LogLevel, message: string): void;
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
  /** Does nothing unless OPENNOTE_PERF_LOG is set. */
  mark(name: PerfMark): void;
}
