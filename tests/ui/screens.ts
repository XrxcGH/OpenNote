// The screens the cross-screen suites visit (ARCHITECTURE.md section 21.6): the focus walk, axe, geometry, and
// the screenshot matrix. Each package adds its screen states in its own file, tests/ui/screens/<area>.ts, whose
// default export is a list from defineScreens. loadScreens finds them all, so no package edits a shared list.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import type { BootOverrides } from '../../app/src/boot/defaults';
import type { FixtureName } from '../../app/src/services/notes/fixtures';

export type SizeClass = 'compact' | 'medium' | 'expanded' | 'wide';
export type Theme = 'light' | 'dark';

/** The viewport for each size class in the screenshot matrix (ARCHITECTURE.md section 21.4). */
export const VIEWPORTS: Record<SizeClass, { width: number; height: number }> = {
  compact: { width: 400, height: 800 },
  medium: { width: 720, height: 900 },
  expanded: { width: 1024, height: 768 },
  wide: { width: 1440, height: 900 },
};

export interface ScreenState {
  /** Unique across every file, such as 'workspace.sample'. */
  readonly id: string;
  readonly description: string;
  /** The address to open, relative to the base URL. Default '/'. */
  readonly path?: string;
  readonly fixture?: FixtureName;
  readonly boot?: BootOverrides;
  /** Default: every size class. */
  readonly sizes?: readonly SizeClass[];
  /** Default: both themes. */
  readonly themes?: readonly Theme[];
  /** Brings the page into the state, for example by opening a menu. */
  prepare?(page: Page): Promise<void>;
}

export function defineScreens(screens: readonly ScreenState[]): readonly ScreenState[] {
  return screens;
}

const FOLDER = join(import.meta.dirname, 'screens');

/** Every screen state from tests/ui/screens/*.ts. Throws when two share an id. */
export async function loadScreens(): Promise<ScreenState[]> {
  const files = readdirSync(FOLDER).filter((file) => file.endsWith('.ts'));
  const lists = await Promise.all(
    files.map(async (file) => {
      const module = (await import(pathToFileURL(join(FOLDER, file)).href)) as { default: readonly ScreenState[] };
      return module.default;
    }),
  );
  const screens = lists.flat();
  const ids = screens.map((screen) => screen.id);
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repeated.length) throw new Error(`Screen ids must be unique: ${repeated.join(', ')}`);
  return screens;
}

/** Opens a screen state at a size and theme, starting the app as Rust would, with a boot payload. */
export async function openScreen(page: Page, screen: ScreenState, where: { size: SizeClass; theme: Theme }) {
  await page.setViewportSize(VIEWPORTS[where.size]);
  const boot = { ...screen.boot, settings: { ...screen.boot?.settings, appearance: { theme: where.theme } } };
  await page.addInitScript(
    (options) => {
      window.__OPENNOTE_DEV__ = { ...window.__OPENNOTE_DEV__, fixture: options.fixture };
      window.__OPENNOTE_BOOT__ = { ...options.boot, bootVersion: 1 };
    },
    { boot, fixture: screen.fixture ?? 'sample' },
  );
  await page.goto(screen.path ?? '/');
  await screen.prepare?.(page);
  await settle(page);
}

/**
 * Waits until nothing on the page is animating. Dialogs, menus, and popovers fade and slide in, and axe, the focus
 * walk, and the screenshots read the page as it is at that moment. Mid-fade, the colors blend with what is behind,
 * and axe reported text contrast the finished dialog does not have. Animations that never end, such as a spinner,
 * are left out.
 */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
    await frame();
    // Finishing one animation can start another, so look again until nothing is left, with a limit.
    for (let round = 0; round < 10; round += 1) {
      const running = document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
      if (running.length === 0) return;
      await Promise.allSettled(running.map((animation) => animation.finished));
      await frame();
    }
  });
}
