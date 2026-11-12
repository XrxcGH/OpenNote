// New projects for the studio's commands (features/page/registrations/codeStudio.ts): a fresh project in a
// language, with its hello starter as the main file, and a project made from a page code block's text.

import { getSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { confirm } from '../../../ui';
import { PROJECT_LANGUAGES } from '../contracts';
import type { CodeProject, ProjectLanguage } from '../contracts';
import { readProject, starterProject } from '../project/model';
import { setStudioTarget } from '../project/studioTarget';
import { helloText } from '../snippets/examples';
import { MAIN_FILES, RUNTIMES } from './languages';
import { resetScratch, SCRATCH, storedScratch } from './source';

/** Code block language names people write, as project languages. */
const ALIASES: Record<string, ProjectLanguage> = {
  py: 'python',
  python3: 'python',
  js: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  'c++': 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  sh: 'bash',
  shell: 'bash',
  rb: 'ruby',
  rs: 'rust',
  cs: 'csharp',
  'c#': 'csharp',
  kt: 'kotlin',
  ps1: 'powershell',
  jl: 'julia',
  sqlite: 'sql',
};

/** The project language of a code block's language name; Python when it names none the studio knows. */
export function projectLanguageOf(name: string | null | undefined): ProjectLanguage {
  const key = (name ?? '').trim().toLowerCase();
  if ((PROJECT_LANGUAGES as readonly string[]).includes(key)) return key as ProjectLanguage;
  return ALIASES[key] ?? 'python';
}

/** A project with one main file in the language, its text the hello starter unless given. */
export function newProjectData(language: ProjectLanguage, text?: string, name?: string): Record<string, unknown> {
  const main = text ?? helloText(language) ?? '';
  const project: CodeProject = starterProject(name ?? t('codeStudio.project.starterName'), main);
  const full = language === 'python' && getSettings().code.pythonRuntime === 'full';
  project.language = language;
  project.runtime = full ? 'python-full' : (RUNTIMES[language]?.[0] ?? 'toolchain');
  project.files = { f01: { path: MAIN_FILES[language], text: main, order: 0 } };
  return project as unknown as Record<string, unknown>;
}

/** True when the scratch project holds work: more than one file, or a file that is not a starter's text. */
export function scratchHasWork(): boolean {
  const data = storedScratch();
  if (!data) return false;
  const project = readProject(data);
  const files = Object.values(project.files);
  if (files.length > 1) return true;
  const starters = new Set([
    '',
    t('codeStudio.project.starterMain'),
    helloText(project.language as ProjectLanguage) ?? '',
  ]);
  return files.some((file) => !starters.has(file.text));
}

/**
 * Opens a project in the scratch slot, after asking when that replaces scratch work. The scratch project has no page
 * undo, so the work would be gone. Resolves false when the person keeps the old one.
 */
export async function replaceScratchProject(data: Record<string, unknown>): Promise<boolean> {
  if (
    scratchHasWork() &&
    !(await confirm({
      title: t('codeStudio.studio.scratchReplace.title'),
      body: t('codeStudio.studio.scratchReplace.body'),
      confirmLabel: t('codeStudio.studio.scratchReplace.confirm'),
      danger: true,
    }))
  ) {
    return false;
  }
  openScratchProject(data);
  return true;
}

/** Opens a project in the studio's scratch slot (no page open, or a read-only page). */
export function openScratchProject(data: Record<string, unknown>): void {
  resetScratch(data);
  setStudioTarget({ block: SCRATCH, run: false });
}
