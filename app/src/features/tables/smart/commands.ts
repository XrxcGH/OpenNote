// The smart-table commands the palette and the table menu run (Phase 7). Each acts on the smart table that had
// focus last, in the column with the caret.
import type { ChartKind, ColumnType, TotalKind } from '../engine';
import { focusedSmart } from './attach';
import { calculatedColumn } from './calculated';
import { chooseValue, editChoices, makeChoice } from './choiceOps';
import { addChart, clearCalculated, fill, filterBy, setFormat, setTotal, sortColumn } from './ops';
import { applyView, saveViewAsking } from './savedViews';
import type { FilterMode } from './ops';
import { runAnalysis } from '../analysis/run';
import type { AnalysisTool } from '../analysis/run';

export type SmartCommand =
  | { run: 'sort'; desc: boolean }
  | { run: 'filter'; mode: FilterMode }
  | { run: 'fill'; direction: 'down' | 'right' }
  | { run: 'format'; type: ColumnType | null }
  | { run: 'decimals'; by: 1 | -1 }
  | { run: 'total'; total: TotalKind | null }
  | { run: 'chart'; kind: ChartKind }
  | { run: 'saveView' }
  | { run: 'showAllRows' }
  | { run: 'calculated' }
  | { run: 'clearCalculated' }
  | { run: 'choice'; multi: boolean }
  | { run: 'chooseValue' }
  | { run: 'editChoices' }
  | { run: 'analyze'; tool: AnalysisTool; output?: 'equation' };

/** Runs a command on the table with focus. False when there is none or the command had nothing to do. */
export async function runSmartCommand(command: SmartCommand): Promise<boolean> {
  const inst = focusedSmart();
  if (!inst) return false;
  const column = Math.max(0, inst.caret()?.column ?? 0);
  switch (command.run) {
    case 'sort':
      return sortColumn(inst, column, command.desc);
    case 'filter':
      return filterBy(inst, command.mode);
    case 'fill':
      return fill(inst, command.direction);
    case 'format':
      return setFormat(inst, column, { type: command.type });
    case 'decimals':
      return setFormat(inst, column, { moreDecimals: command.by });
    case 'total':
      return setTotal(inst, column, command.total);
    case 'chart':
      return addChart(inst, command.kind);
    case 'saveView':
      return saveViewAsking(inst);
    case 'showAllRows':
      return applyView(inst, null);
    case 'calculated':
      return calculatedColumn(inst, column);
    case 'clearCalculated':
      return clearCalculated(inst, column);
    case 'choice':
      return makeChoice(inst, column, command.multi);
    case 'chooseValue':
      return chooseValue(inst, column);
    case 'editChoices':
      return editChoices(inst, column);
    case 'analyze':
      return runAnalysis(inst, command.tool, command.output);
  }
}
