// The workspace screen states. WP5 owns this file after WP0; other packages add their own files here.

import { defineScreens } from '../screens';

export default defineScreens([
  {
    id: 'workspace.sample',
    description: 'The workspace with the sample notebooks and a page open',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Lectures' }).click();
      await page.getByRole('button', { name: 'Mitosis' }).click();
    },
  },
  {
    id: 'workspace.empty',
    description: 'The workspace with no notebooks',
    fixture: 'empty',
  },
]);
