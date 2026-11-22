// Gives a table block's editor the formula references plugin (refsPlugin.ts): reference outlines, picking references
// from the grid, and F4 in a cell. The table extra loads this when the block's editor mounts.
import type { TableExtraHandle, TableExtraHost } from '../../../page';
import { formulaRefsKey, formulaRefsPlugin, pickOnPress, replayBarFormula } from './refsPlugin';

export function attachFormulaRefs(host: TableExtraHost): TableExtraHandle {
  const { editor } = host;
  editor.registerPlugin(formulaRefsPlugin(), (added, plugins) => [added, ...plugins]);
  replayBarFormula(editor.view);
  // Capture phase: the press is seen before the editor turns it into a caret move or a cell selection.
  const onPress = (event: MouseEvent) => {
    if (!editor.isDestroyed && pickOnPress(editor.view, event)) event.stopPropagation();
  };
  const dom = editor.view.dom;
  dom.addEventListener('mousedown', onPress, true);
  return {
    update() {},
    destroy() {
      dom.removeEventListener('mousedown', onPress, true);
      if (!editor.isDestroyed) editor.unregisterPlugin(formulaRefsKey);
    },
  };
}
