// Typed access to the app's Tauri commands and events (ARCHITECTURE.md section 6.4). This file and the rest of
// platform/tauri are the only places that import @tauri-apps/api. Command names follow <domain>_<verb>, event
// names <domain>://<event>, and arguments are camelCase, as Tauri maps them to the Rust parameters.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import type {
  CaptionLayout,
  CaptionState,
  DeviceStatePatch,
  ExitReason,
  ExternalTarget,
  FolderCheck,
  InstallStatus,
  IpcError,
  LogLevel,
  OsAppearance,
  PerfMark,
  Point,
  ReadyTimings,
  Settings,
  SettingsPatch,
  SettingsSectionKey,
  ThemeName,
  Unsubscribe,
  UpdaterStatus,
} from '../types';
import type { ExitResult } from '../bindings/ExitResult';

type None = Record<string, never>;

/** Every app command: its arguments and what it returns. */
export interface Commands {
  settings_update: { args: { patch: SettingsPatch }; result: Settings };
  settings_reset: { args: { section: SettingsSectionKey }; result: Settings };
  state_update: { args: { patch: DeviceStatePatch }; result: null };
  state_flush: { args: None; result: null };
  window_minimize: { args: None; result: null };
  window_toggle_maximize: { args: None; result: null };
  window_close: { args: None; result: null };
  window_set_title: { args: { title: string }; result: null };
  window_show_system_menu: { args: { at: Point | null }; result: null };
  window_set_frame_theme: { args: { theme: ThemeName }; result: null };
  window_set_caption_layout: { args: { layout: CaptionLayout | null }; result: null };
  app_first_paint: { args: None; result: null };
  app_ready: { args: { timings: ReadyTimings }; result: null };
  app_exit_ready: { args: { result: ExitResult }; result: null };
  perf_mark: { args: { name: PerfMark; epochMs: number }; result: null };
  log_write: { args: { level: LogLevel; message: string }; result: null };
  install_status: { args: None; result: InstallStatus };
  install_pick_folder: { args: { initial: string | null }; result: string | null };
  install_check_folder: { args: { path: string }; result: FolderCheck };
  install_move_to_user_programs: { args: None; result: null };
  shell_open_external: { args: { target: ExternalTarget }; result: null };
  notes_snapshot_load: { args: None; result: string | null };
  notes_snapshot_save: { args: { json: string }; result: null };
  updater_status: { args: None; result: UpdaterStatus };
  updater_check: { args: None; result: null };
  updater_download: { args: None; result: null };
  updater_restart_to_update: { args: None; result: null };
  updater_skip: { args: { version: string }; result: null };
  updater_unskip: { args: None; result: null };
  updater_go_back: { args: None; result: null };
}

/** Every app event and its payload. */
export interface Events {
  'settings://changed': { settings: Settings; origin: string };
  'os://appearance-changed': OsAppearance;
  'window://maximized': boolean;
  'window://caption-state': CaptionState;
  'window://forwarded-args': string[];
  'app://before-exit': ExitReason;
  'updater://status': UpdaterStatus;
}

/** Any rejection as an IpcError. A command the shell doesn't have yet reads as code notImplemented. */
export function toIpcError(error: unknown): IpcError {
  if (typeof error === 'object' && error !== null && typeof (error as IpcError).code === 'string') {
    return error as IpcError;
  }
  const message = String(error);
  return { code: /command .* not found/i.test(message) ? 'notImplemented' : 'unknown', message };
}

export async function invoke<C extends keyof Commands>(
  command: C,
  ...args: Commands[C]['args'] extends None ? [] : [Commands[C]['args']]
): Promise<Commands[C]['result']> {
  try {
    return await tauriInvoke<Commands[C]['result']>(command, args[0]);
  } catch (error) {
    throw toIpcError(error);
  }
}

/** For calls nobody waits on. Failures go to the debug console only, so a missing command stays quiet. */
export function fire<C extends keyof Commands>(
  command: C,
  ...args: Commands[C]['args'] extends None ? [] : [Commands[C]['args']]
): void {
  invoke(command, ...args).catch((error: IpcError) => console.debug(`${command}: ${error.message}`));
}

/** Listens for an event. The returned function stops listening, even before Tauri confirms the listener. */
export function listen<E extends keyof Events>(event: E, handler: (payload: Events[E]) => void): Unsubscribe {
  let stopped = false;
  let stop: Unsubscribe | null = null;
  tauriListen<Events[E]>(event, ({ payload }) => handler(payload))
    .then((unlisten) => (stopped ? unlisten() : (stop = unlisten)))
    .catch((error: unknown) => console.debug(`${event}: ${String(error)}`));
  return () => {
    stopped = true;
    stop?.();
  };
}
