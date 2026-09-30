// The settings client in a browser: settings live in memory and merge patches apply as Rust applies them.
// Values outside the schema's choices reject with an IpcError, so tests can prove that updates revert.

import { applyMergePatch } from '../mergePatch';
import type { IpcError, Settings, SettingsClient, SettingsPatch } from '../types';
import { emitter } from './emitter';
import { registerTestHook } from './testHooks';

const CHOICES: Record<string, readonly unknown[]> = {
  'appearance.theme': ['light', 'dark', 'system'],
  'appearance.pageColor': ['matchTheme', 'paper'],
  'appearance.textSize': [80, 90, 100, 110, 125, 150, 175, 200],
  'appearance.motion': ['system', 'reduce'],
  'appearance.density': ['auto', 'mouse', 'touch'],
  'keyboard.preset': ['default', 'onenote'],
  'updates.install': ['auto', 'ask', 'manual'],
  'updates.channel': ['stable', 'beta'],
};

function invalidField(settings: Settings): IpcError | null {
  for (const [path, choices] of Object.entries(CHOICES)) {
    const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], settings);
    if (!choices.includes(value)) return { code: 'invalid', message: `${path} can't be ${String(value)}`, field: path };
  }
  const scale = settings.appearance.uiScale;
  if (typeof scale !== 'number' || scale < 90 || scale > 150) {
    return { code: 'invalid', message: 'appearance.uiScale must be 90 to 150', field: 'appearance.uiScale' };
  }
  return null;
}

export function createWebSettings(initial: Settings, defaults: Settings): SettingsClient {
  let settings = initial;
  const changed = emitter<[Settings, string]>();
  registerTestHook('settings', () => settings);
  return {
    async update(patch: SettingsPatch) {
      const next = applyMergePatch(settings, patch);
      const error = invalidField(next);
      if (error) throw error;
      settings = next;
      changed.emit(settings, 'web');
      return settings;
    },
    async reset(section) {
      settings = { ...settings, [section]: defaults[section] };
      changed.emit(settings, 'web');
      return settings;
    },
    onChange: changed.on,
  };
}
