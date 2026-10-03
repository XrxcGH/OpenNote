// The table the table commands act on, in a module light enough for start-up (owner: WP6). A table block's view
// sets it while its editor is the active one, and keeps it while focus visits the palette or a menu.
import type { TableOp } from '../../../editor/commands/tables';
import { createStore } from '../../../state/store';

export interface TableHandle {
  readonly block: string;
  /** Runs a table command on the cell with the caret. False when it doesn't apply. */
  run(op: TableOp): Promise<boolean>;
  can(op: TableOp): boolean;
  header(): boolean;
  deleteTable(): Promise<void>;
  selectAll(): void;
  openColumnWidth(): void;
}

export const currentTable = createStore<TableHandle | null>(null, 'current table');
