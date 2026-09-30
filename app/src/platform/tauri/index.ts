// The Tauri platform: thin wrappers over the app's commands and events (ARCHITECTURE.md section 6.4).

import { isEnabled } from '../../app/flags';
import type { BootData, Platform } from '../types';
import { createTauriInstall } from './install';
import { createTauriLifecycle } from './lifecycle';
import { tauriLog } from './log';
import { createTauriOs } from './os';
import { createTauriPerf } from './perf';
import { createTauriSettings } from './settings';
import { createTauriShell } from './shell';
import { createTauriSnapshot } from './snapshot';
import { createTauriState } from './state';
import { createTauriUpdater } from './updater';
import { createTauriWindow } from './window';

/** Call after initFlags, so the notes snapshot follows its flag. */
export function createTauriPlatform(boot: BootData): Platform {
  return {
    kind: 'tauri',
    boot,
    settings: createTauriSettings(),
    state: createTauriState(),
    os: createTauriOs(boot.os),
    window: createTauriWindow(boot.state.window.maximized),
    lifecycle: createTauriLifecycle(),
    install: createTauriInstall(),
    updater: createTauriUpdater(boot.updater),
    shell: createTauriShell(),
    notesSnapshot: isEnabled('notes.memorySnapshot') ? createTauriSnapshot() : null,
    perf: createTauriPerf(),
    log: tauriLog,
  };
}
