/* eslint-disable opennote/feature-boundaries -- This test mounts the real page assembly with the page feature's harness. */
// A break block in the live paginated view (R-BRK-3): the block after it starts sheet 2, with no room of its own.
import { afterEach, describe, expect, it } from 'vitest';
import { commandContext } from '../../../commands/registry';
import { commands } from '../../../registries';
import { cleanupPages, renderPage } from '../../page/test/harness';
import type { PageFixture } from '../../page/test/fixtures';
import { pageLayout, readView } from '../layout';
import { attachPagesView } from './controller';
import { shownPagesView } from './shown';

let detach: (() => void) | null = null;
afterEach(async () => {
  detach?.();
  detach = null;
  await cleanupPages();
});

const at = '2026-10-01T09:00:00.000Z';
const block = (id: string, type: string, order: string, data: Record<string, unknown>) => ({
  id,
  type,
  order,
  created: at,
  modified: at,
  data,
});

const fixture: PageFixture = {
  page: {
    id: '01k6f0000000000000000p0002',
    title: 'Breaks',
    created: at,
    modified: at,
    tags: [],
    view: {},
    blocks: [
      block('01k6f0000000000000000t0001', 'text', 'a0', { markdown: 'Before the break.' }),
      block('01k6f0000000000000000b0001', 'break', 'a1', { kind: 'page' }),
      block('01k6f0000000000000000t0002', 'text', 'a2', { markdown: 'After the break.' }),
    ],
    assets: {},
  },
};

describe('a break in the live paginated view', () => {
  it('pushes the block after it to the second sheet', async () => {
    const harness = await renderPage({ fixture });
    detach = attachPagesView(harness.mounted);
    shownPagesView.get()?.setLayout('flow');
    shownPagesView.get()?.setMode('paginated');
    const { sheet } = pageLayout(readView(harness.mounted.layout.view()).view);
    await new Promise((done) => setTimeout(done, 400));
    const top = (id: string) => {
      const element = harness.mounted.layer.view(id)?.element;
      if (!element) throw new Error(`no block ${id}`);
      return element.getBoundingClientRect().top - harness.mounted.viewport.world.getBoundingClientRect().top;
    };
    const zoom = harness.mounted.viewport.camera().zoom;
    expect(top('01k6f0000000000000000t0001') / zoom).toBeLessThan(sheet.height);
    expect(top('01k6f0000000000000000t0002') / zoom).toBeGreaterThanOrEqual(sheet.height);
    expect(shownPagesView.get()?.state().sheets).toBe(2);
  });

  it('binds Ctrl+Enter to the page break only on a paginated page, and the menu command works on any page', async () => {
    const harness = await renderPage({ fixture });
    detach = attachPagesView(harness.mounted);
    const def = commands.get('insert.pageBreak');
    const when = (source: 'keyboard' | 'palette') => def?.when?.(commandContext(source)) ?? false;
    shownPagesView.get()?.setMode('infinite');
    expect(when('keyboard')).toBe(false);
    expect(when('palette')).toBe(true);
    shownPagesView.get()?.setMode('paginated');
    expect(when('keyboard')).toBe(true);
  });
});
