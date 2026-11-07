// Gives a table block's editor its spreadsheet keys (ADR 0063). The table extra loads this when the block's editor
// mounts. The table's choice of keys comes from its data, and the Document keys command stores a new one.
import type { TableExtraHandle, TableExtraHost } from '../../page';
import { appLocale } from '../smart/locale';
import { keysOf, keysPatch, storedKeys } from './mode';
import { setSheetKeys, sheetKeysKey, sheetKeysPlugin, textsOf } from './plugin';

export function attachSheetKeys(host: TableExtraHost): TableExtraHandle {
  const { editor } = host;
  const keys = keysOf(host.data(), textsOf(editor.state.doc));
  const plugin = sheetKeysPlugin({
    spreadsheet: keys === 'spreadsheet',
    announce: (text) => host.announce(text),
    setKeys: (next) => void host.patch(keysPatch(next)),
    dateOrder: () => appLocale().dateOrder,
    locale: () => appLocale().tag,
  });
  // First, so Grid mode's keys come before the table's text keys and the editor's own.
  editor.registerPlugin(plugin, (added, plugins) => [added, ...plugins]);
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
