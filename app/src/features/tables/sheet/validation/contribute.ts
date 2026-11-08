// What validation adds to a table's menus and command registry (ADR 0056). The commands act through the host the
// table editor sets (host.ts). Keys: Alt+Down is the spreadsheet keyboard model's (ADR 0063), not bound here.
import { contribute } from '../registry';
import { validationHost } from './host';

contribute(
  {
    kind: 'command',
    lane: 'validation',
    command: {
      id: 'sheet.validation.open',
      title: 'sheetValidation.command',
      category: 'table',
      scope: 'tableGrid',
      enabled: () => validationHost() !== null,
      run: () => validationHost()?.openDialog(),
    },
  },
  {
    kind: 'command',
    lane: 'validation',
    command: {
      id: 'sheet.validation.list',
      title: 'sheetValidation.commandOpenList',
      category: 'table',
      scope: 'tableGrid',
      enabled: () => validationHost() !== null,
      run: () => {
        validationHost()?.openList();
      },
    },
  },
  {
    kind: 'command',
    lane: 'validation',
    command: {
      id: 'sheet.validation.circle',
      title: 'sheetValidation.commandCircle',
      category: 'table',
      scope: 'tableGrid',
      enabled: () => validationHost() !== null,
      run: () => validationHost()?.circle(true),
    },
  },
  {
    kind: 'command',
    lane: 'validation',
    command: {
      id: 'sheet.validation.clearCircles',
      title: 'sheetValidation.commandClearCircles',
      category: 'table',
      scope: 'tableGrid',
      enabled: () => validationHost()?.circled() === true,
      run: () => validationHost()?.circle(false),
    },
  },
  {
    kind: 'menuItem',
    item: {
      id: 'validation.open',
      lane: 'validation',
      menu: 'data',
      command: 'sheet.validation.open',
      group: 'validation',
      order: 1,
    },
  },
  {
    kind: 'menuItem',
    item: {
      id: 'validation.circle',
      lane: 'validation',
      menu: 'data',
      command: 'sheet.validation.circle',
      group: 'validation',
      order: 2,
    },
  },
  {
    kind: 'menuItem',
    item: {
      id: 'validation.clear',
      lane: 'validation',
      menu: 'data',
      command: 'sheet.validation.clearCircles',
      group: 'validation',
      order: 3,
    },
  },
  {
    kind: 'contextMenu',
    lane: 'validation',
    item: { id: 'sheet.validation.contextOpen', command: 'sheet.validation.open', group: 'validation', order: 1 },
  },
);
