// The cell format bar in a real browser: every palette swatch has a name and axe passes with the palette open, the
// bar's buttons move with arrow keys, and at 400 percent zoom (a 320 pixel column) the bar and the toolbar wrap without
// sideways scrolling.
import { screen, within } from '@testing-library/react';
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
import { commands } from '../../../../registries';
import type { CommandContext } from '../../../../commands/types';
import { BORDER_IDS } from './borders';
import { CellFormatBar } from './CellFormatBar';
import { CELL_COMMAND_IDS, registerCellCommands } from './commands';
import { addHost } from './hosts';
import { FORMAT_CHOICES } from './numberFormats';
import { setChoice } from './actions';
import { currentTable } from '../../../page';
import type { TableHandle } from '../../../page';

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

/** A table editor with a caret in A1, registered as the block `block`. */
function mount(block = 'b1') {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = createBlockEditor(root, tableDataToDoc(data), { kind: 'table', block, host: editorHost });
  editor.commands.focus('start');
  const host = {
    block,
    element: root,
    editor,
    cache: createMarkdownCache(),
    data: () => ({ ...data }),
    table: () => data,
    apply: vi.fn(() => Promise.resolve(true)),
    patch: vi.fn(() => Promise.resolve(undefined)),
    announce: vi.fn(),
  } as unknown as TableExtraHost;
  cleanup.push(addHost(host));
  cleanup.push(() => {
    editor.destroy();
    root.remove();
  });
  return host;
}

/** Runs a registered cell command as the palette does (its flag is a feature switch these tests do not set). */
async function runCommand(id: string): Promise<void> {
  const def = commands.get(id);
  expect(def?.when?.({} as CommandContext)).toBe(true);
  await def!.run({} as CommandContext, undefined as never);
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
});

describe('the cell format bar, layout', () => {
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

describe('the cell format bar, keyboard', () => {
  it('reaches Bold and Fill color from the keyboard alone', async () => {
    mount();
    renderUi(<CellFormatBar block="b1" />);
    const bar = screen.getByRole('toolbar', { name: 'Cell format' });
    // The bar has one tab stop among its buttons.
    const stops = [...bar.querySelectorAll<HTMLElement>('[data-tool]')].filter((button) => button.tabIndex === 0);
    expect(stops).toHaveLength(1);
    // From the end of the Size box, Right Arrow goes into the buttons.
    const size = screen.getByRole('combobox', { name: 'Font size' }) as HTMLInputElement;
    // Tab from the Size box lands on the bar's tab stop (the next tabbable element in the page's order).
    const tabbable = [...bar.querySelectorAll<HTMLElement>('input, button')].filter((one) => one.tabIndex >= 0);
    expect(tabbable[tabbable.indexOf(size) + 1]).toBe(stops[0]);
    // The editor's own focus call from mount() lands in the next frame, so let it pass first.
    await new Promise((done) => setTimeout(done, 100));
    size.focus();
    size.setSelectionRange(size.value.length, size.value.length);
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement, 'after Right Arrow').toBe(stops[0]);
    for (const name of ['Bold', 'Text color', 'Fill color']) {
      for (let i = 0; i < 40 && document.activeElement !== screen.getByRole('button', { name }); i++) {
        await userEvent.keyboard('{ArrowRight}');
      }
      expect(document.activeElement).toBe(screen.getByRole('button', { name }));
    }
    // The button with focus is the one tab stop, and Shift+Tab then Tab comes back to it.
    expect(screen.getByRole('button', { name: 'Fill color' }).tabIndex).toBe(0);
  });
});

describe('the cell format bar, palette focus', () => {
  it('returns focus to Fill color when Escape closes the palette opened by keyboard', async () => {
    mount();
    renderUi(<CellFormatBar block="b1" />);
    await new Promise((done) => setTimeout(done, 100));
    const button = screen.getByRole('button', { name: 'Fill color' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Fill colors' });
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).not.toBe(document.body);
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });
});

describe('the cell format bar, palettes and commands', () => {
  it('opens the palette and writes to the current table, not the first one on the page', async () => {
    const first = mount('b1');
    const second = mount('b2');
    registerCellCommands();
    renderUi(
      <>
        <div data-testid="one">
          <CellFormatBar block="b1" />
        </div>
        <div data-testid="two">
          <CellFormatBar block="b2" />
        </div>
      </>,
    );
    currentTable.set({ block: 'b2' } as TableHandle);
    try {
      await runCommand('table.cell.fill');
      const fill = (id: string) => within(screen.getByTestId(id)).getByRole('button', { name: 'Fill color' });
      await vi.waitFor(() => expect(fill('two').getAttribute('aria-expanded')).toBe('true'));
      expect(fill('one').getAttribute('aria-expanded')).toBe('false');
      await userEvent.keyboard('{Escape}');
      await runCommand('table.cell.borders');
      expect(first.apply).not.toHaveBeenCalled();
      expect(first.patch).not.toHaveBeenCalled();
      expect(
        (second.apply as ReturnType<typeof vi.fn>).mock.calls.length +
          (second.patch as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(0);
    } finally {
      currentTable.set(null);
    }
  });

  it('has a command for every border preset and every number format of the menu', () => {
    for (const id of BORDER_IDS)
      expect(CELL_COMMAND_IDS).toContain(`table.cell.border${id[0].toUpperCase()}${id.slice(1)}`);
    for (const choice of FORMAT_CHOICES) {
      if (['general', 'currency', 'percent'].includes(choice.id)) continue;
      expect(CELL_COMMAND_IDS).toContain(`table.cell.format${choice.id[0].toUpperCase()}${choice.id.slice(1)}`);
    }
    for (const id of [
      'alignJustify',
      'rotateUp',
      'rotateStacked',
      'wrapOverflow',
      'wrapClip',
      'lineStyleDashed',
      'borderColor',
    ])
      expect(CELL_COMMAND_IDS).toContain(`table.cell.${id}`);
  });
});

describe('the cell format bar, names, menus, and width', () => {
  it('announces a number format by its name, never its code', async () => {
    const host = mount();
    await setChoice(host, 'accounting');
    await setChoice(host, 'percent');
    const said = (host.announce as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(said).toEqual(['Cell format Accounting.', 'Cell format Percent.']);
  });

  it('has the underline kinds menu and the font size buttons', () => {
    mount();
    renderUi(<CellFormatBar block="b1" />);
    for (const name of ['Underline style', 'Increase font size', 'Decrease font size'])
      expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('collapses into More at 360 pixels, also when the bar shows after the first render', async () => {
    // The bar renders nothing until its table has a host, then shows: the width watch has to follow the element.
    renderUi(
      <div style={{ inlineSize: 360 }}>
        <CellFormatBar block="b1" />
      </div>,
    );
    expect(screen.queryByRole('toolbar', { name: 'Cell format' })).toBeNull();
    mount();
    await screen.findByRole('toolbar', { name: 'Cell format' });
    expect(await screen.findByRole('button', { name: 'More cell formats' })).toBeTruthy();
  });
});
