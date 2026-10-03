// The table's object toolbar (ARCHITECTURE.md section 13; owner: WP6): rows, columns, the header row, and the
// column width field, shown above a table while its editor is active. A mouse press on it never takes focus from
// the cell, so each command acts on the cell with the caret. Arrow keys move between its buttons.
import { ColumnsIcon } from '@phosphor-icons/react/dist/csr/Columns';
import { ColumnsPlusLeftIcon } from '@phosphor-icons/react/dist/csr/ColumnsPlusLeft';
import { ColumnsPlusRightIcon } from '@phosphor-icons/react/dist/csr/ColumnsPlusRight';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { ArrowsHorizontalIcon } from '@phosphor-icons/react/dist/csr/ArrowsHorizontal';
import { RowsIcon } from '@phosphor-icons/react/dist/csr/Rows';
import { RowsPlusBottomIcon } from '@phosphor-icons/react/dist/csr/RowsPlusBottom';
import { RowsPlusTopIcon } from '@phosphor-icons/react/dist/csr/RowsPlusTop';
import { TextHOneIcon } from '@phosphor-icons/react/dist/csr/TextHOne';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import type { CommandId } from '../../../commands/types';
import type { TableOp } from '../../../editor/commands/tables';
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../../../editor/table/mapping';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { IconButton, TextField } from '../../../ui';
import type { IconProps } from '../../../ui';
import styles from './tables.module.css';

export interface TableToolbarProps {
  can(op: TableOp): boolean;
  header: boolean;
  run(op: TableOp): void;
  /** Opens the More menu at the button. */
  more(anchor: HTMLElement): void;
  /** The width of the column with the caret. */
  width: number;
  widthOpen: boolean;
  openWidth(): void;
  /** Applies a width, or cancels with null; focus goes back to the cell either way. */
  closeWidth(width: number | null): void;
}

interface Tool {
  op: TableOp;
  label: MessageKey;
  command: CommandId;
  icon: ComponentType<IconProps>;
}

const GROUPS: readonly (readonly Tool[])[] = [
  [
    { op: { op: 'rowAbove' }, label: 'tables.commands.rowAbove', command: 'table.rowAbove', icon: RowsPlusTopIcon },
    { op: { op: 'rowBelow' }, label: 'tables.commands.rowBelow', command: 'table.rowBelow', icon: RowsPlusBottomIcon },
    {
      op: { op: 'columnLeft' },
      label: 'tables.commands.columnLeft',
      command: 'table.columnLeft',
      icon: ColumnsPlusLeftIcon,
    },
    {
      op: { op: 'columnRight' },
      label: 'tables.commands.columnRight',
      command: 'table.columnRight',
      icon: ColumnsPlusRightIcon,
    },
  ],
  [
    { op: { op: 'deleteRow' }, label: 'tables.commands.deleteRow', command: 'table.deleteRow', icon: RowsIcon },
    {
      op: { op: 'deleteColumn' },
      label: 'tables.commands.deleteColumn',
      command: 'table.deleteColumn',
      icon: ColumnsIcon,
    },
  ],
];

/** Arrow keys, Home, and End move focus between the toolbar's buttons (APG toolbar pattern). */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-tool]')];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at === -1) return;
  const next =
    event.key === 'ArrowRight'
      ? (at + 1) % buttons.length
      : event.key === 'ArrowLeft'
        ? (at - 1 + buttons.length) % buttons.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : -1;
  if (next === -1) return;
  event.preventDefault();
  buttons.forEach((button, i) => (button.tabIndex = i === next ? 0 : -1));
  buttons[next].focus();
}

function WidthField({ width, close }: { width: number; close(width: number | null): void }) {
  const [value, setValue] = useState(String(width));
  const parsed = Number(value.trim());
  const valid = /^\d+$/.test(value.trim()) && parsed >= MIN_COLUMN_WIDTH && parsed <= MAX_COLUMN_WIDTH;
  const hint = t('tables.width.hint', { min: MIN_COLUMN_WIDTH, max: MAX_COLUMN_WIDTH });
  const field = useRef<HTMLDivElement>(null);
  useEffect(() => field.current?.querySelector('input')?.focus(), []);
  return (
    <div ref={field} className={styles.widthField} role="group" aria-label={t('tables.width.label')}>
      <TextField
        label={t('tables.width.label')}
        value={value}
        onChange={setValue}
        autoSelect
        help={valid ? hint : undefined}
        error={valid ? undefined : hint}
        // An invalid width keeps the field open, with the range as its error.
        onCommit={() => valid && close(parsed)}
        onCancel={() => close(null)}
      />
    </div>
  );
}

export function TableToolbar(props: TableToolbarProps) {
  const { can, header, run, more, width, widthOpen, openWidth, closeWidth } = props;
  const moreButton = useRef<HTMLSpanElement>(null);
  const button = (tool: Tool, first: boolean) => (
    <span key={tool.command} data-tool-slot="">
      <IconButton
        label={t(tool.label)}
        icon={tool.icon}
        command={tool.command}
        disabled={can(tool.op) ? undefined : 'aria'}
        tabIndex={first ? 0 : -1}
        onPress={() => run(tool.op)}
      />
    </span>
  );
  return (
    <div className={styles.toolbarWrap}>
      <div
        role="toolbar"
        aria-label={t('tables.toolbar.label')}
        className={styles.toolbar}
        onKeyDown={moveFocus}
        // A mouse press keeps the caret in its cell; keyboard and touch activation still work.
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) event.preventDefault();
        }}
        ref={(element) => element?.querySelectorAll('button').forEach((one) => one.setAttribute('data-tool', ''))}
      >
        {GROUPS.map((group, g) => (
          <span key={g} className={styles.group}>
            {group.map((tool, i) => button(tool, g === 0 && i === 0))}
          </span>
        ))}
        <span className={styles.group}>
          <IconButton
            label={t('tables.commands.headerRow')}
            icon={TextHOneIcon}
            command="table.headerRow"
            pressed={header}
            tabIndex={-1}
            onPress={() => run({ op: 'headerRow' })}
          />
          <IconButton
            label={t('tables.commands.columnWidth')}
            icon={ArrowsHorizontalIcon}
            command="table.columnWidth"
            hasPopup="dialog"
            expanded={widthOpen}
            tabIndex={-1}
            onPress={openWidth}
          />
          <span ref={moreButton}>
            <IconButton
              label={t('tables.toolbar.more')}
              icon={DotsThreeIcon}
              hasPopup="menu"
              tabIndex={-1}
              onPress={() => more(moreButton.current?.querySelector('button') ?? moreButton.current!)}
            />
          </span>
        </span>
      </div>
      {widthOpen ? <WidthField width={width} close={closeWidth} /> : null}
    </div>
  );
}
