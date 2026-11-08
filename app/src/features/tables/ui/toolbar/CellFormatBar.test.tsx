// The cell format bar in a real browser: every palette swatch has a name and axe passes with the palette open, the
// bar's buttons move with arrow keys, and at 400 percent zoom (a 320 pixel column) the bar and the toolbar wrap without
// sideways scrolling.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createBlockEditor } from '../../../../editor/extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../../../../editor/host';
import type { EditorHost } from '../../../../editor/host';
import { createMarkdownCache } from '../../../../editor/markdown';
import type { TableData } from '../../../../editor/schema/specs';
import { tableDataToDoc } from '../../../../editor/table/mapping';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import type { TableExtraHost } from '../../../page';
// The toolbar's own style module decides when it shows, so the test uses it as the page does.
// eslint-disable-next-line opennote/feature-boundaries
import { TableToolbar } from '../../../page/tables/TableToolbar';
// eslint-disable-next-line opennote/feature-boundaries
import tableStyles from '../../../page/tables/tables.module.css';
import { CellFormatBar } from './CellFormatBar';
import { addHost } from './hosts';

const editorHost: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => true,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

const data: TableData = {
  header: false,
  columns: [0, 1, 2].map((c) => ({ id: `col${c}`, width: 100 })),
  rows: [0, 1].map((r) => ({
    id: `row${r}`,
    cells: Object.fromEntries([0, 1, 2].map((c) => [`col${c}`, { markdown: `${'ABC'[c]}${r + 1}` }])),
  })),
};

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
});

/** A table editor with a caret in A1, registered as the block `b1`. */
function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = createBlockEditor(root, tableDataToDoc(data), { kind: 'table', block: 'b1', host: editorHost });
  editor.commands.focus('start');
  const host = {
    block: 'b1',
    element: root,
    editor,
    cache: createMarkdownCache(),
    data: () => ({ ...data }),
    table: () => data,
    apply: () => Promise.resolve(true),
    patch: () => Promise.resolve(undefined),
    announce: () => {},
  } as unknown as TableExtraHost;
  cleanup.push(addHost(host));
  cleanup.push(() => {
    editor.destroy();
    root.remove();
  });
  return host;
}

describe('the cell format bar', () => {
  it('names every swatch of the fill palette and passes axe in both themes', async () => {
    for (const theme of ['light', 'dark'] as const) {
      mount();
      const { container, unmount } = renderUi(<CellFormatBar block="b1" />, { theme });
      await userEvent.click(screen.getByRole('button', { name: 'Fill color' }));
      const palette = await screen.findByRole('dialog', { name: 'Fill colors' });
      expect(screen.getByRole('button', { name: 'Amber, lighter 40%' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Indigo, darker 25%' })).toBeTruthy();
      for (const swatch of palette.querySelectorAll('button')) {
        expect((swatch.getAttribute('aria-label') ?? swatch.textContent ?? '').trim()).not.toBe('');
      }
      await expectNoAxeViolations(palette);
      expect(container).toBeTruthy();
      unmount();
      cleanup.splice(0).forEach((stop) => stop());
    }
  });

  it('has no axe violations as a bar, and arrow keys move between its buttons', async () => {
    mount();
    const { container } = renderUi(<CellFormatBar block="b1" />);
    await expectNoAxeViolations(container);
    const bar = screen.getByRole('toolbar', { name: 'Cell format' });
    const boldButton = screen.getByRole('button', { name: 'Bold' });
    boldButton.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Italic' }));
    expect(bar.contains(document.activeElement)).toBe(true);
  });

  it('wraps without sideways scrolling at 400 percent zoom', async () => {
    mount();
    renderUi(
      <div
        className={tableStyles.wrapper}
        data-current=""
        style={{ inlineSize: 320, marginBlockStart: 160 }}
        data-testid="column"
      >
        <TableToolbar
          block="b1"
          can={() => true}
          header={false}
          run={vi.fn()}
          more={vi.fn()}
          width={100}
          widthOpen={false}
          openWidth={vi.fn()}
          closeWidth={vi.fn()}
        />
      </div>,
    );
    const bar = await screen.findByRole('toolbar', { name: 'Cell format' });
    const column = screen.getByTestId('column');
    expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
    expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth);
    expect(bar.getBoundingClientRect().right).toBeLessThanOrEqual(column.getBoundingClientRect().right + 1);
  });
});
