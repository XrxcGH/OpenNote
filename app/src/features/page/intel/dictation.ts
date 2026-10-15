// Dictate into the text block that has the cursor (A2-24). The sink types each phrase at the caret as one edit, and
// remembers what it typed so "undo that" takes back just the last phrase. Loads on first use.
import type { Editor } from '@tiptap/core';
import { META_COMMAND } from '../../../editor/meta';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { targetEditor } from '../formattingBar/target';

interface Typed {
  from: number;
  to: number;
  text: string;
}

/** The sink for dictation: types at the caret of `editor`. */
export function editorSink(editor: Editor) {
  const typed: Typed[] = [];
  const stay = () => editor.isEditable && !editor.isDestroyed;
  return {
    before(): string {
      const { $from } = editor.state.selection;
      return editor.state.doc.textBetween($from.start(), $from.pos, '\n', ' ');
    },
    insert(text: string): void {
      if (!stay()) return;
      const { from } = editor.state.selection;
      const previous = from > 0 ? editor.state.doc.textBetween(Math.max(0, from - 1), from, ' ', ' ') : '';
      const spaced = previous !== '' && !/[\s(“]/.test(previous) ? ` ${text}` : text;
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setMeta(META_COMMAND, true);
          return true;
        })
        .insertContent(spaced)
        .run();
      typed.push({ from, to: editor.state.selection.to, text: spaced });
      if (typed.length > 20) typed.shift();
    },
    newline(): void {
      if (stay()) editor.chain().focus().insertContent({ type: 'hardBreak' }).run();
    },
    paragraph(): void {
      if (stay()) editor.chain().focus().splitBlock().run();
    },
    undoLast(): boolean {
      const last = typed.pop();
      if (!last || !stay()) return false;
      const { doc } = editor.state;
      // Only if it is still there as typed; the person may have moved on, and then nothing is deleted.
      if (last.to > doc.content.size || doc.textBetween(last.from, last.to, '\n', ' ') !== last.text) return false;
      editor.chain().focus().deleteRange({ from: last.from, to: last.to }).run();
      return true;
    },
  };
}

/** Starts dictating into the focused text block, or stops when already dictating. */
export async function toggleDictate(): Promise<void> {
  const dictation = await import('../../dictation');
  if (dictation.isDictating()) {
    await dictation.stopDictation();
    announce(t('intelMore.dictation.stopped'));
    return;
  }
  const editor = targetEditor();
  if (!editor) {
    showToast({ message: t('intelMore.dictation.needsEditor') });
    return;
  }
  const started = await dictation.dictate(editorSink(editor), {
    onProblem: (message) => showToast({ message: t('intelMore.dictation.failed', { message }), tone: 'danger' }),
    onStopped: () => announce(t('intelMore.dictation.stopped')),
  });
  if (started) announce(t('intelMore.dictation.listening'));
}
