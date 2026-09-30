// The workspace screen states. WP5 owns this file after WP0; other packages add their own files here.
// Each state opens through the boot payload's saved location, so it is the same screen at every size class, where
// the notebooks live in the pane, the drawer, or the compact stack.

import type { BootOverrides } from '../../../app/src/boot/defaults';
import { defineScreens } from '../screens';

interface Where {
  view: 'workspace';
  notebookId: string;
  sectionId: string;
  pageId: string | null;
}

const mitosis: Where = { view: 'workspace', notebookId: 'n-biology', sectionId: 's-lectures', pageId: 'p-mitosis' };

const at = (location: Where): BootOverrides => ({ state: { location } }) as BootOverrides;

export default defineScreens([
  {
    id: 'workspace.sample',
    description: 'The workspace with the sample notebooks and a page open',
    boot: at(mitosis),
  },
  {
    id: 'workspace.empty',
    description: 'The workspace with no notebooks',
    fixture: 'empty',
  },
  {
    id: 'workspace.drawer',
    description: 'The medium layout with the notebooks drawer open',
    boot: at(mitosis),
    sizes: ['medium'],
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Show notebooks' }).click();
      await page.getByRole('dialog', { name: 'Notebooks' }).waitFor();
    },
  },
  {
    id: 'workspace.overlay',
    description: 'The expanded layout with the pages overlay open',
    boot: at(mitosis),
    sizes: ['expanded'],
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Show pages' }).click();
      await page.getByRole('treeitem', { name: 'Mitosis' }).waitFor();
    },
  },
  {
    id: 'workspace.compact.pages',
    description: 'The compact layout on the pages screen of a section',
    boot: at({ ...mitosis, pageId: null }),
    sizes: ['compact'],
  },
]);
