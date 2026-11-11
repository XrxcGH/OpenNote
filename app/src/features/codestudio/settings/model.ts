// Settings, then Code (DESIGN 5.6): what the section reads and how it writes. Every change is a merge patch of the
// `code` group, which Rust checks and keeps (app/src-tauri/src/settings/code.rs); the store changes at once, so an
// open editor follows without a reload (the editor listens to the settings store).

import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../../../state/settings';
import type { Settings, SettingsPatch } from '../../../platform/types';
import { PROJECT_LANGUAGES } from '../contracts';
import { DEFAULT_INDENT } from '../editor/indent';
import type { EditorLanguage } from '../editor/indent';

export type CodeSettings = Settings['code'];
export type CodeIndent = CodeSettings['indent'][string];

/** The languages Settings lists: every project language and Makefiles. */
export const SETTING_LANGUAGES: readonly EditorLanguage[] = [...PROJECT_LANGUAGES, 'makefile'];

/** Their tools need a tab character (gofmt; make before each recipe line), so "Insert spaces" is fixed off. */
export const TAB_LANGUAGES: readonly EditorLanguage[] = ['go', 'makefile'];

/** The ranges Rust accepts (settings/code.rs). Tier 1 runs at most 60 s and 256 MiB. */
export const RANGES = {
  tabSize: [1, 8],
  timeLimitSeconds: [1, 60],
  memoryLimitMib: [16, 256],
} as const;

export const clamp = (key: keyof typeof RANGES, value: number): number => {
  const [low, high] = RANGES[key];
  return Math.min(high, Math.max(low, Math.round(Number.isFinite(value) ? value : low)));
};

/** A language's indent as the editor uses it: the setting, or the language's default. */
export function indentOf(language: EditorLanguage, code: CodeSettings = getSettings().code): CodeIndent {
  const set = code.indent[language];
  const base = DEFAULT_INDENT[language];
  const indent = set ?? { tabSize: base.size, insertSpaces: !base.tabs };
  return TAB_LANGUAGES.includes(language) ? { ...indent, insertSpaces: false } : indent;
}

/** Changes some of the Code settings. */
export function changeCode(patch: MergePatchOf<CodeSettings>): Promise<void> {
  return updateSettings({ code: patch } as SettingsPatch);
}

type MergePatchOf<T> = { [K in keyof T]?: T[K] | null };

/** Sets one language's indent; the language's default when it is the same as the default. */
export function changeIndent(language: EditorLanguage, indent: CodeIndent): Promise<void> {
  const base = DEFAULT_INDENT[language];
  const tabSize = clamp('tabSize', indent.tabSize);
  const insertSpaces = TAB_LANGUAGES.includes(language) ? false : indent.insertSpaces;
  const same = tabSize === base.size && insertSpaces === !base.tabs;
  return updateSettings({ code: { indent: { [language]: same ? null : { tabSize, insertSpaces } } } } as SettingsPatch);
}

/** The patch that puts every Code setting back to its default, per-language indents included. */
export function resetPatch(code: CodeSettings = getSettings().code): SettingsPatch {
  const defaults = DEFAULT_SETTINGS.code;
  const indent: Record<string, null> = {};
  for (const language of Object.keys(code.indent)) indent[language] = null;
  return { code: { ...defaults, indent } } as SettingsPatch;
}

export function resetCode(): Promise<void> {
  return updateSettings(resetPatch());
}

/** The name the status bar gives the suggestion engine. */
export function engineKey(
  code: CodeSettings = getSettings().code,
):
  | 'codeStudio.studio.status.engineOff'
  | 'codeStudio.studio.status.engineRules'
  | 'codeStudio.studio.status.engineModel' {
  if (code.suggestions === 'off') return 'codeStudio.studio.status.engineOff';
  return code.suggestions === 'automaticModel'
    ? 'codeStudio.studio.status.engineModel'
    : 'codeStudio.studio.status.engineRules';
}
