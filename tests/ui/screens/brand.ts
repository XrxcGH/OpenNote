// The screens that carry the desk-by-the-window look (docs/BRAND.md sections 4 and 8): the three setup steps, the
// empty Trash, and Settings, Appearance. The focus walk, axe, and the screenshot matrix visit them with their
// drawings, ambient canvas, and theme-card marks in place. workspace.empty and settings.about are in their own files.

import type { BootOverrides } from '../../../app/src/boot/defaults';
import { defineScreens } from '../screens';

const firstRun = { firstRun: true, state: { setup: { status: 'notStarted' } } } as BootOverrides;
const trash = { state: { location: { view: 'trash' } } } as BootOverrides;

export default defineScreens([
  {
    id: 'setup.welcome',
    description: 'First-run setup, the welcome step with the desk',
    boot: firstRun,
    prepare: async (page) => {
      await page.getByRole('heading', { level: 1, name: 'Welcome to OpenNote' }).waitFor();
    },
  },
  {
    id: 'setup.look',
    description: 'First-run setup, Choose your look, with the theme cards',
    boot: firstRun,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Get started' }).click();
      await page.getByRole('heading', { level: 1, name: 'Choose your look' }).waitFor();
    },
  },
  {
    id: 'setup.storage',
    description: 'First-run setup, where to keep things, with the notebook color chips',
    boot: firstRun,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Get started' }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('heading', { level: 1, name: 'Where to keep things' }).waitFor();
    },
  },
  {
    id: 'trash.empty',
    description: 'The Trash view with nothing in it, on its page card with the candle and books',
    boot: trash,
    prepare: async (page) => {
      await page.getByText('Trash is empty.').waitFor();
    },
  },
  {
    id: 'settings.appearance',
    description: 'Settings, Appearance, with the three theme cards in a row',
    prepare: async (page) => {
      await page.keyboard.press('Control+Comma');
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      const link = page.getByRole('link', { name: 'Appearance', exact: true });
      if (await link.isVisible()) await link.click();
      await page.getByRole('heading', { level: 1, name: 'Appearance', exact: true }).waitFor();
      await page.getByRole('radiogroup', { name: 'Theme' }).waitFor();
    },
  },
]);
