// The web platform: every client as an in-memory fake, so `npm run app:dev`, Playwright, and component tests run
// the real interface in a plain browser (ARCHITECTURE.md section 6.1). Production builds never include it.

import { defaultBootData, mergeBoot } from '../../boot/defaults';
import type { BootOverrides } from '../../boot/defaults';
import type { NotesFixture } from '../../services/notes/fixtures';
import { DEFAULT_SETTINGS } from '../../state/settings';
import type { Platform } from '../types';
import { createWebAudio } from './audio';
import { createWebDiagnostics } from './diagnostics';
import { createWebInstall } from './install';
import { createWebInterop } from './interop';
import { createWebLifecycle } from './lifecycle';
import type { WebLifecycle } from './lifecycle';
import { createWebLog } from './log';
import { createWebOs } from './os';
import { createWebClipboard } from './clipboard';
import { createWebExports } from './exports';
import { createWebImages } from './images';
import { createWebPageExtras } from './pageExtras';
import { createWebPages } from './pages';
import { createWebSpeech } from './speech';
import { createWebSpelling } from './spelling';
import { createWebPerf } from './perf';
import { createWebSearch } from './search';
import { createWebSettings } from './settings';
import { createWebShell } from './shell';
import { createWebSnapshot } from './snapshot';
import { createWebState } from './state';
import { createWebUpdater } from './updater';
import { createWebWindow } from './window';
import type { WebWindow } from './window';

export { registerTestHook } from './testHooks';

export interface WebPlatformOptions {
  /** Overrides merged into the default boot payload, key by key. */
  boot?: BootOverrides;
  /** The seed library. Default 'sample'. */
  fixture?: NotesFixture;
  /** Follow the browser's dark mode as the Windows setting. Default false. */
  followBrowser?: boolean;
}

export interface WebPlatform extends Platform {
  readonly kind: 'web';
  readonly window: WebWindow;
  readonly lifecycle: WebLifecycle;
  readonly perf: ReturnType<typeof createWebPerf>;
  /** The fake import and export, with the log of what the interface asked it for. */
  readonly interop: ReturnType<typeof createWebInterop>;
  /** Changes the fake Windows appearance and sends the change event. */
  setOs: ReturnType<typeof createWebOs>['set'];
  readonly logEntries: ReturnType<typeof createWebLog>['entries'];
}

export function createWebPlatform(options: WebPlatformOptions = {}): WebPlatform {
  const boot = mergeBoot(defaultBootData(), options.boot);
  const lifecycle = createWebLifecycle();
  const os = createWebOs(boot.os, options.followBrowser ?? false);
  const log = createWebLog();
  const pages = createWebPages();
  return {
    kind: 'web',
    boot,
    settings: createWebSettings(boot.settings, DEFAULT_SETTINGS),
    state: createWebState(boot.state),
    os,
    window: createWebWindow(() => void lifecycle.requestExit('close')),
    lifecycle,
    install: createWebInstall(boot.install),
    updater: createWebUpdater(boot.updater),
    shell: createWebShell(),
    pages,
    search: createWebSearch(pages),
    diagnostics: createWebDiagnostics(),
    spelling: createWebSpelling(),
    clipboard: createWebClipboard(),
    images: createWebImages(),
    pageExtras: createWebPageExtras(),
    exports: createWebExports(),
    audio: createWebAudio(),
    speech: createWebSpeech(),
    interop: createWebInterop(),
    notesSnapshot: createWebSnapshot(options.fixture ?? 'sample'),
    notesCore: null,
    perf: createWebPerf(),
    log: log.log,
    setOs: os.set,
    logEntries: log.entries,
  };
}
