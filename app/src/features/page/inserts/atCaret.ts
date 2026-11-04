// How a tool's answer line, steps, or equation goes into the text block with the caret. The page's insert listener
// (smart.ts) calls these; they are apart from it so a test can run them on a real editor.
import type { Editor } from '@tiptap/core';
import { META_COMMAND } from '../../../editor/meta';

/** The end of the top-level block holding `pos`: after a list, not inside its last item. */
function afterTopLevel(editor: Editor, pos: number): number {
  const $pos = editor.state.doc.resolve(pos);
  return $pos.depth === 0 ? pos : $pos.after(1);
}

/** Whether the content is blocks (the worked steps are a title and a list), not a line of text. */
const isBlocks = (text: string): boolean => /^\s*<(p|ol|ul|div|h[1-6]|table)[\s>]/i.test(text);

/**
 * Where an insert goes. A word selected by a double-click is replaced, and the space after it stays. A selected
 * block (the equation an earlier insert left selected) is never replaced: the new content goes after it, so a second
 * insert adds to the first. Blocks of steps go after the block holding the caret, never into a list item, so steps
 * after steps are a second list, and an answer after steps is below them.
 */
function insertRange(editor: Editor, kind: 'word' | 'inline' | 'blocks'): { from: number; to: number } {
  const { selection, doc } = editor.state;
  const { from, to } = selection;
  // A node selection (the equation an insert left selected) has the node it holds.
  if ('node' in selection) return { from: afterTopLevel(editor, to), to: afterTopLevel(editor, to) };
  if (kind === 'blocks') {
    const $to = doc.resolve(to);
    const top = $to.depth === 0 ? null : $to.node(1);
    // An empty paragraph (the caret on a new line) takes the steps; anything else keeps its text.
    if (top && top.type.name === 'paragraph' && top.content.size === 0)
      return { from: $to.before(1), to: $to.after(1) };
    const end = afterTopLevel(editor, to);
    return { from: end, to: end };
  }
  if (kind === 'inline') return { from, to };
  const selected = doc.textBetween(from, to, ' ', ' ');
  if (selected.trim() === '') return { from, to };
  const lead = selected.length - selected.trimStart().length;
  const trail = selected.length - selected.trimEnd().length;
  return { from: from + lead, to: to - trail };
}

/** Whether the caret (with nothing selected) is in a heading, where an answer must not be appended to the title. */
function inHeading(editor: Editor): boolean {
  const { selection } = editor.state;
  return selection.empty && !('node' in selection) && selection.$from.parent.type.name === 'heading';
}

/** Each insert is a command, so it is an undo step of its own and never joins the typing before it. */
function asCommand(
  editor: Editor,
  content: Parameters<Editor['commands']['insertContentAt']>[1],
  range: {
    from: number;
    to: number;
  },
): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setMeta(META_COMMAND, true);
      return true;
    })
    .insertContentAt(range, content)
    .run();
}

/** Puts text (or the HTML of the worked steps) at the caret. False when the editor takes nothing. */
export function insertTextAtCaret(editor: Editor, text: string): boolean {
  // In a heading the answer is its own line below it: appended, it would change the title ("2026" became "20264").
  if (inHeading(editor) && !isBlocks(text)) {
    const end = afterTopLevel(editor, editor.state.selection.to);
    return asCommand(editor, `<p>${text}</p>`, { from: end, to: end });
  }
  return asCommand(editor, text, insertRange(editor, isBlocks(text) ? 'blocks' : 'word'));
}

/** Puts a display or inline equation at the caret. False for an empty source or an editor with no math. */
export function insertMathAtCaret(editor: Editor, source: string, display: boolean): boolean {
  const type = editor.schema.nodes[display ? 'mathBlock' : 'mathInline'];
  if (!type || source.trim() === '') return false;
  // A display equation does not go inside a heading: it goes on its own line below it.
  const range =
    display && inHeading(editor)
      ? { from: afterTopLevel(editor, editor.state.selection.to), to: afterTopLevel(editor, editor.state.selection.to) }
      : insertRange(editor, 'inline');
  return asCommand(editor, { type: type.name, attrs: { source: source.trim() } }, range);
}
