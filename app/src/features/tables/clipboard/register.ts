// Registers the table clipboard at start-up (ADR 0067): the table extra that gives each table block copy, cut, and
// paste with Excel, Google Sheets, LibreOffice, and other OpenNote tables, and the Paste special command. The editor
// code loads when a table shows.
import { chord } from '../../../commands/chords';
import { tableExtras } from '../../page';
import type { TableExtraHost } from '../../page';
import { contribute } from '../sheet/registry';

const hosts = new Set<TableExtraHost>();

/** The table block that holds focus, if its clipboard is attached. */
function focusedHost(): TableExtraHost | undefined {
  const at = document.activeElement;
  if (!at) return undefined;
  for (const host of hosts) if (host.element.contains(at)) return host;
  return undefined;
}

export const PASTE_SPECIAL_COMMAND = 'table.pasteSpecial' as const;

/** Registers Paste special. Returns a function that takes it back. */
export function registerPasteSpecial(): () => void {
  return contribute({
    kind: 'command',
    lane: 'clipboard',
    command: {
      id: PASTE_SPECIAL_COMMAND,
      title: 'sheetClipboard.commands.special',
      keywords: 'sheetClipboard.commands.keywords',
      category: 'table',
      keys: [chord('Ctrl+Alt+V')],
      scope: 'editor.table',
      // In a table, Ctrl+Alt+V is Paste special, as in Excel, not dictation.
      refines: 'intel.dictate',
      allowInTextInput: true,
      flag: 'tables.sheetWrites',
      when: () => focusedHost() !== undefined,
      run: () => {
        const host = focusedHost();
        if (host) void import('./attach').then((module) => module.pasteSpecial(host));
      },
    },
  });
}

if (!tableExtras.get('sheetClipboard')) {
  registerPasteSpecial();
  tableExtras.register({
    id: 'sheetClipboard',
    flag: 'tables.sheetWrites',
    attach: async (host) => {
      const handle = (await import('./attach')).attachSheetClipboard(host);
      hosts.add(host);
      return {
        update: (block) => handle.update(block),
        destroy: () => {
          hosts.delete(host);
          handle.destroy();
        },
      };
    },
  });
}
