// The editor extensions of the quality-of-life features, added to every editor through the editor extension
// registry: Reading mode makes the editor read-only, and a checklist can keep its finished items at the bottom.
// This file loads right after start-up (registrations/qol.ts), and the registry is read when an editor mounts.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { editorExtensions } from '../../../editor/extensions/kit';
import { shownMounted } from '../pagesApi';
import { CHECKLIST_META, countTasks, finishedModeOf, moveFinishedToBottom } from './checklist';
import { readingLock } from './stores';

const lockKey = new PluginKey('opennoteReadingLock');
const orderKey = new PluginKey('opennoteChecklistOrder');

/** Re-reads the lock in an editor that is already mounted. */
export function refreshEditable(editor: {
  view: { state: { tr: unknown }; dispatch(tr: never): void };
  isDestroyed: boolean;
}) {
  if (!editor.isDestroyed) editor.view.dispatch(editor.view.state.tr as never);
}

const ReadingLock = Extension.create({
  name: 'opennoteReadingLock',
  addProseMirrorPlugins() {
    return [new Plugin({ key: lockKey, props: { editable: () => !readingLock.get() } })];
  },
});

const ChecklistOrder = Extension.create({
  name: 'opennoteChecklistOrder',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: orderKey,
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta(CHECKLIST_META))) {
            return null;
          }
          const block = editor.options.editorProps?.attributes
            ? (editor.options.editorProps.attributes as Record<string, string>)['data-block']
            : undefined;
          const data = block ? (shownMounted.get()?.layer.block(block)?.data ?? {}) : {};
          if (finishedModeOf(data) !== 'bottom') return null;
          // Only a plain check: more finished items than before, and the same words.
          if (countTasks(newState.doc).done <= countTasks(oldState.doc).done) return null;
          if (newState.doc.textContent !== oldState.doc.textContent) return null;
          const tr = newState.tr;
          if (!moveFinishedToBottom(tr)) return null;
          return tr.setMeta(CHECKLIST_META, true);
        },
      }),
    ];
  },
});

if (!editorExtensions.get('qol.lock')) {
  editorExtensions.register({
    id: 'qol.lock',
    order: 900,
    flag: 'page.readingLock',
    kinds: ['text', 'table'],
    create: () => ReadingLock,
  });
  editorExtensions.register({
    id: 'qol.checklistOrder',
    order: 901,
    flag: 'page.checklistExtras',
    kinds: ['text'],
    create: () => ChecklistOrder,
  });
}
