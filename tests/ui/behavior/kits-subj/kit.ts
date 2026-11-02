// Shared by the subject-kit specs: the catalog of the twelve windows and a helper that opens one from the palette.
import type { Locator, Page } from '@playwright/test';
import { expect } from '../../fixtures';
import { openPage } from '../../ink';

export interface SubjectKit {
  id: string;
  /** What to type in the palette, and the command's title. */
  search: string;
  command: RegExp;
  /** The window's accessible name. */
  window: string;
  /** Whether the window picks its tool with tabs (true) or a Topic or Tool list (false). */
  tabs: boolean;
}

export const SUBJECT_KITS: readonly SubjectKit[] = [
  {
    id: 'civil',
    search: 'civil and chem',
    command: /^Civil and chemical engineering$/,
    window: 'Civil and chemical engineering',
    tabs: false,
  },
  {
    id: 'earth',
    search: 'earth sciences',
    command: /^Open the earth sciences kit$/,
    window: 'Earth sciences',
    tabs: false,
  },
  {
    id: 'humanities',
    search: 'history, places',
    command: /^Open the history, places, languages, and texts kit$/,
    window: 'History, places, languages, and texts',
    tabs: true,
  },
  {
    id: 'lifesys',
    search: 'life science',
    command: /^Open life science tools$/,
    window: 'Life science tools',
    tabs: true,
  },
  {
    id: 'mathkit',
    search: 'engineering math',
    command: /^Open the engineering mathematics tools$/,
    window: 'Engineering mathematics',
    tabs: true,
  },
  {
    id: 'modphys',
    search: 'modern physics',
    command: /^Open the modern physics and astronomy tools$/,
    window: 'Modern physics and astronomy',
    tabs: false,
  },
  { id: 'molbio', search: 'biology tools', command: /^Open the biology tools$/, window: 'Biology tools', tabs: true },
  {
    id: 'music',
    search: 'music, script',
    command: /^Open the music, script, camera, and studio tools$/,
    window: 'Music, script, camera, and studio tools',
    tabs: true,
  },
  {
    id: 'reasoning',
    search: 'reasoning kit',
    command: /^Open the reasoning kit$/,
    window: 'Reasoning kit',
    tabs: true,
  },
  {
    id: 'signals',
    search: 'signals and sound',
    command: /^Open signals and sound tools$/,
    window: 'Signals and sound',
    tabs: false,
  },
  {
    id: 'statinfer',
    search: 'statistics kit',
    command: /^Open the statistics kit$/,
    window: 'Statistics: inference and design',
    tabs: true,
  },
  {
    id: 'statmodels',
    search: 'statistical models',
    command: /^Open the statistical models tools$/,
    window: 'Statistical models',
    tabs: true,
  },
];

export function kitById(id: string): SubjectKit {
  const found = SUBJECT_KITS.find((k) => k.id === id);
  if (!found) throw new Error(`no kit ${id}`);
  return found;
}

/** Opens a new page, then the kit window from the command palette, and waits for its default example to show. */
export async function openKit(page: Page, kit: SubjectKit): Promise<Locator> {
  await openPage(page);
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await box.pressSequentially(kit.search, { delay: 10 });
  await page.getByRole('option', { name: kit.command }).first().click();
  const dialog = page.getByRole('dialog', { name: kit.window, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A matcher for text that may sit in separate table cells: each space in `text` matches any run of whitespace, or none. */
export function loose(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*'));
}
