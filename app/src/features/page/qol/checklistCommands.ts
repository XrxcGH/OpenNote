// What the checklist commands do (FEATURES.md, Checklist shortcuts): Check all and Uncheck all for the list at the
// caret, and the choice for finished items of the text box it is in. The choice is kept in the box's data, so it
// goes with the page and every device shows the same list.
import { fromChange, runCommand } from '../../../editor/commands/command';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { targetEditor } from '../formattingBar/target';
import { shownMounted } from '../pagesApi';
import { CHECKLIST_META, inChecklist, moveFinishedToBottom, setAllChecked } from './checklist';
import type { FinishedMode } from './checklist';
import { setPrefs, pageExtrasPrefs } from './prefs';

/** Whether the caret is in a list that has check boxes. */
export function inChecklistNow(): boolean {
  const editor = targetEditor();
  return !!editor && inChecklist(editor.state.doc, editor.state.selection.from);
}

export function checkAll(checked: boolean): void {
  const editor = targetEditor();
  if (!editor || !inChecklist(editor.state.doc, editor.state.selection.from))
    return announce(t('pageExtras.checklist.notInList'));
  runCommand(
    editor,
    fromChange((tr) => setAllChecked(tr, checked)),
  );
  announce(t(checked ? 'pageExtras.checklist.checkedAll' : 'pageExtras.checklist.uncheckedAll'));
}

/** Keeps, moves, or hides the finished items of the box with the caret. */
export async function setFinishedMode(mode: FinishedMode): Promise<void> {
  const editor = targetEditor();
  const mounted = shownMounted.get();
  const block = editor?.view.dom.dataset.block;
  if (!editor || !mounted || !block) return;
  const current = mounted.layer.block(block);
  if (!current) return;
  const data = mode === 'keep' ? null : mode;
  await mounted.sync.send({ edits: [{ edit: 'patchBlock', block, data: { finished: data } }] }).catch(() => undefined);
  const next = { ...current.data };
  if (data === null) delete next.finished;
  else next.finished = data;
  mounted.layer.upsert({ ...current, data: next });
  if (mode === 'bottom') {
    runCommand(
      editor,
      fromChange((tr) => {
        tr.setMeta(CHECKLIST_META, true);
        return moveFinishedToBottom(tr);
      }),
      { focus: false },
    );
  }
  announce(
    t(
      mode === 'keep'
        ? 'pageExtras.checklist.modeKeep'
        : mode === 'bottom'
          ? 'pageExtras.checklist.modeBottom'
          : 'pageExtras.checklist.modeHide',
    ),
  );
}

export function toggleDoneCount(): void {
  setPrefs({ doneCount: !pageExtrasPrefs.get().doneCount });
}
