// The Tauri platform: thin wrappers over the app's commands and events (ARCHITECTURE.md section 6.4).

import { isEnabled } from '../../app/flags';
import type { BootData, Platform } from '../types';
import { createTauriExports } from './exports';
import { createTauriAudio } from './audio';
import { createTauriDiagnostics } from './diagnostics';
import { createTauriInstall } from './install';
import { createTauriInterop } from './interop';
import { createTauriClipboard } from './clipboard';
import { createTauriImages } from './images';
import { createTauriNotesCore } from './notes';
import { createTauriPages } from './pages';
import { createTauriSpeech } from './speech';
import { createTauriSpelling } from './spelling';
import { createTauriLifecycle } from './lifecycle';
import { tauriLog } from './log';
import { createTauriOs } from './os';
import { createTauriPerf } from './perf';
import { createTauriSearch } from './search';
import { createTauriSettings } from './settings';
import { createTauriShell } from './shell';
import { createTauriSnapshot } from './snapshot';
import { createTauriState } from './state';
import { createTauriUpdater } from './updater';
import { createTauriWindow } from './window';

/** Call after initFlags, so the notes service follows its flags. */
export function createTauriPlatform(boot: BootData): Platform {
  const images = createTauriImages();
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
    pages: createTauriPages(images),
    search: createTauriSearch(),
    diagnostics: createTauriDiagnostics(),
    spelling: createTauriSpelling(),
    clipboard: createTauriClipboard(),
    images,
    exports: createTauriExports(),
    audio: createTauriAudio(),
    speech: createTauriSpeech(),
    // With storage.core, the core keeps the notes; the Phase 2 snapshot is only for a build without it.
    notesSnapshot: !isEnabled('storage.core') && isEnabled('notes.memorySnapshot') ? createTauriSnapshot() : null,
    notesCore: isEnabled('storage.core') ? createTauriNotesCore() : null,
    interop: createTauriInterop(),
    perf: createTauriPerf(),
    log: tauriLog,
  };
}
