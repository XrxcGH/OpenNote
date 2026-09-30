// The boot payload a plain browser gets (ARCHITECTURE.md section 6.3), and the defaults the web platform and
// tests start from. In a browser, the Windows appearance comes from the browser's media queries.

import type { BootData, DeviceState, OsAppearance } from '../platform/types';
import { DEFAULT_OS } from '../state/os';
import { DEFAULT_SETTINGS } from '../state/settings';
import { DEFAULT_UPDATER_STATUS } from '../state/updater';
import { tokens } from '../theme/tokens';
import { RUST_DEVICE_STATE_DEFAULTS } from './rustDefaults';

export const DEFAULT_DEVICE_STATE: DeviceState = {
  stateVersion: 1,
  window: { placement: null, maximized: false },
  panes: {
    notebooks: { width: tokens.size.sidebar, collapsed: false },
    pages: { width: tokens.size.pageList, collapsed: false },
  },
  location: { view: 'workspace', notebookId: null, sectionId: null, pageId: null },
  expanded: [],
  lastPageBySection: {},
  recentCommands: [],
  recentPages: [],
  setup: { status: 'done', step: null, completedSteps: [], draft: null },
  pageViews: {},
  ink: RUST_DEVICE_STATE_DEFAULTS.ink,
};

export function defaultBootData(os: OsAppearance = DEFAULT_OS): BootData {
  return {
    bootVersion: 1,
    version: '0.0.0-dev',
    channel: 'dev',
    architecture: 'x64',
    firstRun: false,
    settings: DEFAULT_SETTINGS,
    settingsReadOnly: false,
    state: DEFAULT_DEVICE_STATE,
    os,
    resolvedTheme: os.dark ? 'dark' : 'light',
    webview2Version: '',
    install: {
      exePath: '',
      inUserPrograms: false,
      folderWritable: true,
      hasStartMenuShortcut: false,
      isDevBuild: true,
    },
    updater: DEFAULT_UPDATER_STATUS,
    flagOverrides: {},
    notices: [],
    perf: { processStartEpochMs: 0 },
  };
}

/** The appearance a browser reports: dark mode, forced colors, and reduced motion. */
export function browserAppearance(view: Pick<Window, 'matchMedia'> | undefined = globalThis.window): OsAppearance {
  const query = (media: string) => view?.matchMedia?.(media).matches ?? false;
  return {
    ...DEFAULT_OS,
    dark: query('(prefers-color-scheme: dark)'),
    contrast: query('(forced-colors: active)'),
    animations: !query('(prefers-reduced-motion: reduce)'),
  };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Merges overrides into boot data key by key. Arrays and other values replace. */
export function mergeBoot(base: BootData, overrides: DeepPartial<BootData> = {}): BootData {
  const merge = (target: unknown, patch: unknown): unknown => {
    if (!isPlainObject(target) || !isPlainObject(patch)) return patch === undefined ? target : patch;
    const result: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(patch)) result[key] = merge(target[key], value);
    return result;
  };
  return merge(base, overrides) as BootData;
}

export type BootOverrides = DeepPartial<BootData>;
