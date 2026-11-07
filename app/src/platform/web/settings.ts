// The settings client in a browser: settings live in memory and merge patches apply as Rust applies them.
// Values outside the schema's choices reject with an IpcError, so tests can prove that updates revert.

import { applyMergePatch } from '../mergePatch';
import type { IpcError, Settings, SettingsClient, SettingsPatch } from '../types';
import { emitter } from './emitter';
import { registerTestHook } from './testHooks';

const PASTE = ['keepSource', 'mergeFormatting', 'textOnly'];

const CHOICES: Record<string, readonly unknown[]> = {
  'appearance.theme': ['light', 'dark', 'system'],
  'appearance.pageColor': ['matchTheme', 'paper'],
  'appearance.textSize': [80, 90, 100, 110, 125, 150, 175, 200],
  'appearance.motion': ['system', 'reduce'],
  'appearance.density': ['auto', 'mouse', 'touch'],
  'keymap.preset': ['default', 'docs', 'onenote'],
  'updates.install': ['auto', 'ask', 'manual'],
  'updates.channel': ['stable', 'beta'],
  'text.paste.word': PASTE,
  'text.paste.docs': PASTE,
  'text.paste.onenote': PASTE,
  'text.paste.web': PASTE,
  'text.measurementUnit': ['inches', 'centimeters', 'millimeters', 'points', 'picas'],
  'text.darkCustomBackgrounds': ['exact', 'soften'],
  'tables.newTableKeys': ['spreadsheet', 'document'],
  'tables.formulaBar': [true, false],
  'code.pythonRuntime': ['quick', 'full'],
  'code.suggestions': ['off', 'onRequest', 'automaticRules', 'automaticModel'],
  'code.acceptButton': ['touchOrPen', 'always', 'never'],
  'code.diagnostics': ['errors', 'warnings', 'everything'],
  'code.cStandard': ['c99', 'c11', 'c17', 'c23'],
  'code.cppStandard': ['cpp14', 'cpp17', 'cpp20', 'cpp23'],
};

/** The code group's number ranges, as Rust checks them (settings/code.rs). */
const RANGES: Record<string, readonly [number, number]> = {
  'code.timeLimitSeconds': [1, 60],
  'code.memoryLimitMib': [16, 256],
};

/** A key of code.indent, as Rust checks it (settings/code.rs, is_language_id). */
const LANGUAGE_ID = /^[a-z](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

/** The code.indent map: at most 64 languages, each a language id with a tab size of 1 to 8. */
function invalidIndent(indent: unknown): string | null {
  const entries = Object.entries((indent ?? {}) as Record<string, { tabSize?: unknown }>);
  if (entries.length > 64) return 'code.indent has more than 64 languages';
  for (const [id, choice] of entries) {
    if (!LANGUAGE_ID.test(id)) return `code.indent can't use ${id} as a language id`;
    const size = choice?.tabSize;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 8) {
      return `code.indent.${id} tab size must be 1 to 8`;
    }
  }
  return null;
}

function invalidField(settings: Settings): IpcError | null {
  for (const [path, choices] of Object.entries(CHOICES)) {
    const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], settings);
    if (!choices.includes(value)) return { code: 'invalid', message: `${path} can't be ${String(value)}`, field: path };
  }
  for (const [path, [min, max]] of Object.entries(RANGES)) {
    const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], settings);
    if (typeof value !== 'number' || value < min || value > max) {
      return { code: 'invalid', message: `${path} must be ${min} to ${max}`, field: path };
    }
  }
  const indent = invalidIndent(settings.code?.indent);
  if (indent) return { code: 'invalid', message: indent, field: 'code.indent' };
  const scale = settings.appearance.uiScale;
  if (typeof scale !== 'number' || scale < 90 || scale > 150) {
    return { code: 'invalid', message: 'appearance.uiScale must be 90 to 150', field: 'appearance.uiScale' };
  }
  const locale = settings.language?.locale;
  if (typeof locale !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(locale)) {
    return { code: 'invalid', message: "language.locale isn't a language tag", field: 'language.locale' };
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
