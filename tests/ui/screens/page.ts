// The page view's screen states (Phase 4 PLAN.md section 12; owner: WP8). The sampler page holds every node, mark,
// callout type, a table, code, and images, so axe, the focus walk, and the screenshots see each one, in static
// blocks and with the text's editor mounted.

import type { BootOverrides } from '../../../app/src/boot/defaults';
import { defineScreens } from '../screens';

const membranes = {
  state: {
    location: { view: 'workspace', notebookId: 'n-biology', sectionId: 's-lectures', pageId: 'p-membranes' },
  },
} as BootOverrides;

export default defineScreens([
  {
    id: 'page.sampler',
    description: 'The sampler page in static blocks',
    path: '/?fixture=sampler',
    boot: membranes,
    prepare: async (page) => {
      await page.getByText('Every kind of text').waitFor();
    },
  },
  {
    id: 'page.sampler.editing',
    description: 'The sampler page with its text editor mounted and the caret in it',
    path: '/?fixture=sampler',
    boot: membranes,
    sizes: ['compact', 'wide'],
    prepare: async (page) => {
      const text = page.getByRole('textbox', { name: 'Page text' });
      await text.click({ position: { x: 4, y: 4 } });
      await page.locator('[role="textbox"][aria-label="Page text"][contenteditable="true"]').waitFor();
    },
  },
]);
