// The table extra of the pointer lane: it gives each table block with spreadsheet keys the pointer layer (the fill
// handle, the touch handles, and the border strokes). It is a plugin so the layer follows the editor's state.
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { TableExtraHandle, TableExtraHost } from '../../page';
import { attachPointerLayer } from './layer';

export const sheetPointerKey = new PluginKey('opennote.sheetPointer');

export function attachSheetPointer(host: TableExtraHost): TableExtraHandle {
  const { editor } = host;
  const plugin = new Plugin({
    key: sheetPointerKey,
    view: (view) => {
      const layer = attachPointerLayer(view, host);
      return { update: () => layer.update(), destroy: () => layer.destroy() };
    },
  });
  editor.registerPlugin(plugin);
  return {
    update() {},
    destroy() {
      if (!editor.isDestroyed) editor.unregisterPlugin(sheetPointerKey);
    },
  };
}
