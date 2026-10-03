// The caret for a pointer-down mount (ARCHITECTURE.md section 7.2): the browser began that gesture on text that
// wasn't editable yet, so the pool places the caret where the pointer pressed, and extends the selection as the
// pointer moves, until it lifts.
import type { Editor } from '@tiptap/core';

export function placeAtPoint(editor: Editor, down: PointerEvent): void {
  const { view } = editor;
  const anchor = view.posAtCoords({ left: down.clientX, top: down.clientY })?.pos ?? view.state.doc.content.size;
  view.focus();
  editor.commands.setTextSelection(anchor);
  const doc = view.dom.ownerDocument;
  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== down.pointerId || editor.isDestroyed) return;
    const head = view.posAtCoords({ left: move.clientX, top: move.clientY });
    if (head) editor.commands.setTextSelection({ from: anchor, to: head.pos });
  };
  const onEnd = (end: PointerEvent) => {
    if (end.pointerId !== down.pointerId) return;
    doc.removeEventListener('pointermove', onMove, true);
    doc.removeEventListener('pointerup', onEnd, true);
    doc.removeEventListener('pointercancel', onEnd, true);
  };
  doc.addEventListener('pointermove', onMove, true);
  doc.addEventListener('pointerup', onEnd, true);
  doc.addEventListener('pointercancel', onEnd, true);
}
