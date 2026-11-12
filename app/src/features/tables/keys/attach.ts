// Gives a table block's editor its spreadsheet keys (ADR 0063). The table extra loads this when the block's editor
// mounts. The table's choice of keys comes from its data, and the Document keys command stores a new one.
import type { TableExtraHandle, TableExtraHost } from '../../page';
import { appLocale } from '../smart/locale';
import { DOCUMENT_KEYS_COMMAND } from './bindings';
import { keysOf, keysPatch, storedKeys } from './mode';
import { runSheetCommand, setSheetKeys, sheetKeysKey, sheetKeysPlugin, textsOf } from './plugin';
import type { SheetKeysOptions } from './plugin';
import { keysTip } from './tip';

export function attachSheetKeys(host: TableExtraHost): TableExtraHandle {
  const { editor } = host;
  const texts = textsOf(editor.state.doc);
  const keys = keysOf(host.data(), texts);
  const options: SheetKeysOptions = {
    spreadsheet: keys === 'spreadsheet',
    announce: (text) => host.announce(text),
    setKeys: (next) => void host.patch(keysPatch(next)),
    dateOrder: () => appLocale().dateOrder,
    locale: () => appLocale().tag,
  };
  const plugin = sheetKeysPlugin(options);
  // First, so Grid mode's keys come before the table's text keys and the editor's own.
  editor.registerPlugin(plugin, (added, plugins) => [added, ...plugins]);
  keysTip(host.data(), texts, () => {
    // The command switches the keys, so it runs only while the table still has spreadsheet keys.
    if (!editor.isDestroyed && sheetKeysKey.getState(editor.state)?.spreadsheet)
      runSheetCommand(editor.view, options, DOCUMENT_KEYS_COMMAND);
  });
  return {
    update(block) {
      const stored = storedKeys(block.data);
      if (stored && !editor.isDestroyed) setSheetKeys(editor.view, stored === 'spreadsheet');
    },
    destroy() {
      if (!editor.isDestroyed) editor.unregisterPlugin(sheetKeysKey);
    },
  };
}
