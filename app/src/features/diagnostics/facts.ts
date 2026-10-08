// What only the interface knows, for the feedback file's system summary: the language, display scale, text size,
// theme, density, and which feature flags are on. The host adds the versions and the counts. No titles, paths, or
// names are read here.

import { FLAGS, isEnabled } from '../../app/flags';
import { getSettings } from '../../state/settings';
import { layoutStore } from '../../state/layout';
import type { UiFacts } from './types';

export function uiFacts(): UiFacts {
  const { appearance } = getSettings();
  return {
    locale: typeof navigator === 'undefined' ? null : navigator.language,
    displayScalePercent: typeof window === 'undefined' ? null : Math.round(window.devicePixelRatio * 100),
    textSizePercent: appearance.textSize,
    theme: appearance.theme,
    density: layoutStore.get().density,
    enabledFlags: FLAGS.filter((flag) => isEnabled(flag.id)).map((flag) => flag.id),
  };
}
