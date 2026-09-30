// The palette, the quick switcher, and the shortcut list, for the focus walk, axe, and the screenshot matrix.

import { defineScreens } from '../screens';

export default defineScreens([
  {
    id: 'palette.commands',
    description: 'The command palette with results for "dark"',
    prepare: async (page) => {
      await page.keyboard.press('Control+KeyK');
      await page.getByRole('combobox').fill('dark');
      await page.getByRole('option', { name: /Toggle dark mode/ }).waitFor();
    },
  },
  {
    id: 'palette.switcher',
    description: 'The quick switcher with recent pages',
    prepare: async (page) => {
      await page.keyboard.press('Control+KeyO');
      await page.getByRole('combobox', { name: 'Page name' }).waitFor();
    },
  },
  {
    id: 'shortcuts.dialog',
    description: 'The keyboard shortcut list',
    prepare: async (page) => {
      await page.keyboard.press('Control+Slash');
      await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor();
    },
  },
]);
