// TEMPORARY CI diagnostics, removed in a later commit. Mirrors the viewport changes before the hanging spec.
import { screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { commandBar, titleBarItems } from './registries';
import { renderApp } from './test';
import { environment, limited, look, report } from './test/zzdiag';

afterEach(async () => {
  await page.viewport(1280, 800);
});

it('diag viewport narrow', async () => {
  const stopBar = commandBar.replaceAll([]);
  await page.viewport(640, 800);
  await renderApp({ sizeClass: 'medium' });
  await screen.findByRole('toolbar', { name: 'Home' }).catch(() => null);
  stopBar();
});

it('diag more button after a viewport change', async () => {
  report.env = environment();
  const stopBar = commandBar.replaceAll([]);
  const chip = titleBarItems.register({
    id: 'test.chip',
    side: 'end',
    order: 1,
    priority: 1,
    compact: 'bottomMore',
    Component: () => <button type="button">{'Update ready'}</button>,
  });
  await renderApp({ sizeClass: 'compact' });
  const bar = screen.getByRole('navigation', { name: 'Quick actions' });
  const more = within(bar).getByRole('button', { name: 'More commands' });
  report.more = look(more);
  report.moreByRole = page.getByRole('button', { name: 'More commands' }).elements().length;
  report.moreBySelector = page.elementLocator(more).elements().length;
  report.timeOrigin = performance.timeOrigin;
  await limited('clickByRoleShort', () => page.getByRole('button', { name: 'More commands' }).click({ timeout: 3000 }));
  await limited('clickMore', () => userEvent.click(more));
  report.moreAfter = { expanded: more.getAttribute('aria-expanded'), dialogs: screen.queryAllByRole('dialog').length };
  chip();
  stopBar();
  expect.fail('DIAG-VIEWPORT ' + JSON.stringify(report, null, 1));
});
