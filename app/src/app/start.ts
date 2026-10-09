// Start-up, as ARCHITECTURE.md section 8.2 orders it. Before React renders, it reads the boot payload, picks the
// platform, creates the stores, loads the features, and starts the notes service.

import { hasInjectedBoot, readBoot, readDevOptions } from '../boot/read';
import { installDispatcher } from '../commands/dispatcher';
import { configureCommands } from '../commands/registry';
import '../features';
import { installDiagnostics, offerSafeStart } from '../features/diagnostics';
import { installPageZoom, installPages } from '../features/page';
import { installSearch } from '../features/search';
import { installOpenFiles } from '../features/interop';
import { installSetup } from '../features/setup';
import { installAppearance } from '../features/theme';
import { createPlatform } from '../platform';
import type { BootData, Platform } from '../platform/types';
import { createNotesService } from '../services/notes';
import type { NotesService } from '../services/notes';
import { installLayerEscape } from '../state/layers';
import { initLayout } from '../state/layout';
import { initOs } from '../state/os';
import { initSession } from '../state/session';
import { initSettings } from '../state/settings';
import { initUpdater } from '../state/updater';
import { setPseudoLocale } from '../strings/t';
import { initTheme } from '../theme/theme';
import { installAppContextMenu } from '../ui';
import { initFlags } from './flags';

/** The channel, then overrides from the boot payload and the experimental settings. */
export function initFlagsFrom(boot: BootData): void {
  initFlags(boot.channel, boot.flagOverrides, boot.settings.experimental.flags);
}

/** Fills every shared store from the boot payload and follows the platform's change events. */
export function initStores(boot: BootData, platform: Platform): void {
  initSettings(boot, platform);
  initOs(boot, platform);
  initSession(boot, platform);
  initUpdater(boot, platform);
}

/**
 * Wires the window-wide listeners: shortcuts, Escape for the layer stack, the size class, the theme, the
 * appearance controls (density and Ctrl+wheel text size), Ctrl+wheel page zoom, and the app's context menu in
 * editors. It also opens first-run setup when steps are pending.
 */
export function installApp(
  platform: Platform,
  notes: NotesService,
  options: { keepThemeInStorage: boolean },
): () => void {
  configureCommands({ platform, notes });
  const stops = [
    initTheme(platform, { keepInStorage: options.keepThemeInStorage }),
    installDispatcher(),
    installLayerEscape(),
    initLayout(),
    installAppearance(),
    installPageZoom(),
    installPages(platform),
    installSearch(platform, notes),
    installOpenFiles(platform, notes),
    installAppContextMenu(),
    installSetup(platform, notes),
    installDiagnostics(platform),
  ];
  return () => stops.forEach((stop) => stop());
}

export async function startApp(): Promise<{ platform: Platform; notes: NotesService }> {
  const boot = readBoot();
  const dev = readDevOptions();
  initFlagsFrom(boot);
  if (import.meta.env.VITE_PLATFORM === 'web') setPseudoLocale(dev.pseudo);
  const platform = createPlatform(boot, { fixture: dev.fixture });
  initStores(boot, platform);
  const notes = await createNotesService(platform);
  installApp(platform, notes, { keepThemeInStorage: !hasInjectedBoot() });
  // After two crashes in a row, safe mode is offered before the notebook opens.
  await offerSafeStart(platform);
  return { platform, notes };
}
