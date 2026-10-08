// Rendering helpers for component tests (PLAN.md section 3.14). renderApp starts the whole app on a test
// platform, as main.tsx does; renderUi renders one element with a theme and density.

import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { App } from '../App';
import { initFlagsFrom, initStores, installApp } from '../app/start';
import type { BootOverrides } from '../boot/defaults';
import { mergeBoot, defaultBootData } from '../boot/defaults';
import type { WebPlatform } from '../platform/web';
import type { Settings } from '../platform/types';
import { NotesProvider } from '../services/notes';
import { createMemoryNotesService } from '../services/notes/memory';
import type { NotesFixture } from '../services/notes/fixtures';
import type { NotesService } from '../services/notes/types';
import { closeAllLayers } from '../state/layers';
import { setDensity, setSizeClass } from '../state/layout';
import type { Density, SizeClass } from '../state/layout';
import { resetStores } from '../state/store';
import { clearAnnouncements } from '../ui/announce';
import { createTestPlatform } from './platform';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface RenderAppOptions {
  fixture?: NotesFixture;
  settings?: DeepPartial<Settings>;
  sizeClass?: SizeClass;
  /** Sets the theme preference. */
  theme?: 'light' | 'dark';
  density?: Density;
  /** Anything else in the boot payload, such as the Windows appearance. */
  boot?: BootOverrides;
}

export interface RenderedApp extends RenderResult {
  platform: WebPlatform;
  notes: NotesService;
}

// Beta turns the custom title bar and Snap Layouts on in every non-Stable build. The shell tests start on the native
// frame, and the ones for the custom frame say so with their own flagOverrides.
const NATIVE_FRAME = { 'shell.customFrame': false, 'window.snapLayouts': false };

const disposers: (() => void)[] = [];

/**
 * Closes open overlays, undoes renderApp's window listeners, and resets every store. The component test setup
 * calls it. Menus and confirmations render in their own roots, which RTL's cleanup doesn't reach.
 */
export function disposeApp(): void {
  closeAllLayers();
  disposers.splice(0).forEach((dispose) => dispose());
  resetStores();
  clearAnnouncements();
  document.documentElement.removeAttribute('data-theme');
}

export async function renderApp(options: RenderAppOptions = {}): Promise<RenderedApp> {
  const settings = {
    ...options.settings,
    appearance: { ...options.settings?.appearance, ...(options.theme && { theme: options.theme }) },
  };
  const boot = mergeBoot(mergeBoot(defaultBootData(), { flagOverrides: NATIVE_FRAME }), {
    ...options.boot,
    settings,
  } as BootOverrides);
  const platform = createTestPlatform({ boot, fixture: options.fixture });
  initFlagsFrom(boot);
  initStores(boot, platform);
  const notes = createMemoryNotesService({ seed: options.fixture ?? 'sample' });
  disposers.push(installApp(platform, notes, { keepThemeInStorage: true }));
  if (options.sizeClass) setSizeClass(options.sizeClass);
  if (options.density) setDensity(options.density);
  // index.html gives the app a #root that fills the window, and the workspace sizes itself from it.
  const host = document.body.appendChild(document.createElement('div'));
  host.id = 'root';
  disposers.push(() => host.remove());
  const result = render(
    <NotesProvider service={notes}>
      <App />
    </NotesProvider>,
    { container: host },
  );
  return { ...result, platform, notes };
}

export function renderUi(
  element: ReactElement,
  options: { theme?: 'light' | 'dark'; density?: Density } = {},
): RenderResult {
  if (options.theme) document.documentElement.dataset.theme = options.theme;
  if (options.density) setDensity(options.density);
  return render(element);
}
