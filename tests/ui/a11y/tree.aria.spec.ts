// ARIA snapshots of both trees with the sample fixture and a section open: the tree pattern's roles, levels,
// names, and states, as a screen reader sees them. The "More actions" button sits inside each row but outside its
// name, and the kind and color are the row's description.

import { expect, test } from '../fixtures';

test('the notebooks tree has the tree pattern with levels and the open section selected', async ({ page }) => {
  await page.goto('/');
  const notebooks = page.getByRole('tree', { name: 'Notebooks' });
  await notebooks.getByRole('treeitem', { name: 'Lectures' }).click();
  await expect(page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Mitosis' })).toBeVisible();
  await expect(notebooks).toMatchAriaSnapshot(`
    - tree "Notebooks":
      - treeitem "Biology 101" [expanded] [level=1]:
        - button "More actions for Biology 101"
      - treeitem "Lectures" [level=2] [selected]:
        - button "More actions for Lectures"
      - treeitem "Labs" [level=2]:
        - button "More actions for Labs"
      - treeitem "Exam prep" [level=2]:
        - button "More actions for Exam prep"
      - treeitem "Work" [level=1]:
        - button "More actions for Work"
      - treeitem "Personal" [level=1]:
        - button "More actions for Personal"
      - treeitem "Recipes" [level=1]:
        - button "More actions for Recipes"
      - treeitem "Travel" [level=1]:
        - button "More actions for Travel"
  `);
});

test('the pages tree nests subpages under their page and marks the open page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  const pages = page.getByRole('tree', { name: 'Pages' });
  await expect(pages.getByRole('treeitem', { name: 'Mitosis' })).toBeVisible();
  await expect(pages).toMatchAriaSnapshot(`
    - tree "Pages":
      - treeitem "Cell structure" [expanded] [level=1] [selected]:
        - button "More actions for Cell structure"
      - treeitem "Membranes" [level=2]:
        - button "More actions for Membranes"
      - treeitem "Mitosis" [level=1]:
        - button "More actions for Mitosis"
      - treeitem "Meiosis" [level=1]:
        - button "More actions for Meiosis"
      - treeitem "Photosynthesis" [level=1]:
        - button "More actions for Photosynthesis"
  `);
});

test('every row keeps exactly one tab stop in each tree', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  for (const name of ['Notebooks', 'Pages']) {
    const stops = page.getByRole('tree', { name }).locator('[role="treeitem"][tabindex="0"]');
    await expect(stops).toHaveCount(1);
  }
});
