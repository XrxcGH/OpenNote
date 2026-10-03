// The root attributes and variables for the appearance settings and the Windows appearance (ARCHITECTURE.md
// sections 4.6, 9.6, and 9.7). CSS selects on them, so no component reads the settings to choose its look.
//
// The attribute data-contrast="on" means a Windows contrast theme is on.
// The attribute data-motion="reduce" means "Always reduce motion" is on, or Windows animation effects are off.
// The attribute data-page-color="paper" keeps pages paper white in the dark theme.
// The variable --zoom is the effective zoom Rust applied: the text size times the Windows text scale.
// The variable --ui-scale is the interface size, from 0.9 to 1.5, for sidebars, toolbars, and menus.

import './appearance.css';
import type { OsAppearance, Settings } from '../platform/types';

/** The interface sizes offered in Settings (FEATURES.md, Interface size). Rust accepts 90 to 150. */
export const UI_SCALES = [90, 100, 110, 125, 150] as const;

function setAttribute(root: HTMLElement, name: string, value: string | null): void {
  if (value === null) root.removeAttribute(name);
  else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
}

export function applyAppearance(root: HTMLElement, settings: Settings, os: OsAppearance): void {
  const { appearance } = settings;
  setAttribute(root, 'data-contrast', os.contrast ? 'on' : null);
  setAttribute(root, 'data-motion', appearance.motion === 'reduce' || !os.animations ? 'reduce' : null);
  setAttribute(root, 'data-page-color', appearance.pageColor === 'paper' ? 'paper' : null);
  root.style.setProperty('--zoom', String(os.zoom));
  root.style.setProperty('--ui-scale', String(appearance.uiScale / 100));
}
