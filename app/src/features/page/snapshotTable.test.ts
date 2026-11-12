// @vitest-environment jsdom
// The shown page as print reads it, with a table typed into: the cells typed since the table's last save are in it
// (A2-A11-4: the print preview showed a new table without the text typed into it).
import { afterEach, expect, it } from 'vitest';
import type { TableData } from '../../editor/schema/specs';
import { newTableData } from '../../editor/table/mapping';
import type { BlockJson } from '../../services/pages/types';
import { whenViewReady } from './tables/lazyView';
import { textPageFixture } from './test/fixtures';
import { cleanupPages, renderPage } from './test/harness';
import { snapshotPage } from './snapshot';
import './register';

afterEach(cleanupPages);

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const TABLE = '01k6f0000000000000000t0002';

it('has the cells typed into a table since it was last saved', async () => {
  const data: TableData = newTableData(3, 3, true);
  const fixture = textPageFixture('Before the table');
  const at = fixture.page.blocks[0].created;
  const block: BlockJson = {
    id: TABLE,
    type: 'table',
    order: 'a1',
    created: at,
    modified: at,
    data: data as unknown as Record<string, unknown>,
  };
  fixture.page.blocks.push(block);
  const page = await renderPage({ fixture, flags: { 'page.tables': true } });
  await whenViewReady(page.wrapper(TABLE));
  const editor = page.mounted.pool.mount(TABLE, { kind: 'start' }, 'target')!;
  editor.commands.focus('start');
  editor.commands.insertContent('Typed cell');
  const json = snapshotPage(page.mounted, 'Test page');
  const shown = json.blocks.find((one) => one.id === TABLE)!.data as unknown as TableData;
  const first = shown.columns[0].id;
  expect(shown.rows[0].cells[first]?.markdown).toBe('Typed cell');
});
