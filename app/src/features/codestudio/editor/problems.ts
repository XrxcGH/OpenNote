// Showing problems (DESIGN 6.2): squiggles, gutter marks, hover with fixes, and F8 and Shift+F8 to move to the next
// and previous problem, which also reads it out. Lane code:L10 finds the problems; this only shows them.

import { forEachDiagnostic, lintGutter, nextDiagnostic, previousDiagnostic, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { t } from '../../../strings/t';
import { announce } from '../../../ui/announce';
import type { Diagnostic } from '../contracts';

function toCodeMirror(item: Diagnostic, length: number): CmDiagnostic {
  const from = Math.max(0, Math.min(item.from, length));
  return {
    from,
    to: Math.max(from, Math.min(item.to, length)),
    severity: item.severity,
    source: item.source,
    message: item.code ? `${item.message} (${item.code})` : item.message,
    actions: (item.fixes ?? []).map((fix) => ({
      name: fix.title,
      apply: (view: EditorView) => {
        view.dispatch({
          changes: fix.edits.map(({ from: a, to, insert }) => ({ from: a, to, insert })),
          userEvent: 'input.fix',
        });
      },
    })),
  };
}

/** Shows a file's problems, replacing the ones shown before. */
export function showProblems(view: EditorView, items: readonly Diagnostic[]): void {
  const length = view.state.doc.length;
  view.dispatch(
    setDiagnostics(
      view.state,
      items.map((item) => toCodeMirror(item, length)),
    ),
  );
}

/** The problem at the caret, read out: "Line 3: Undefined name 'totl'". */
function readOut(view: EditorView): void {
  const head = view.state.selection.main.head;
  let found: CmDiagnostic | null = null;
  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    if (!found && from <= head && head <= to) found = diagnostic;
  });
  const hit = found as CmDiagnostic | null;
  if (!hit) {
    announce(t('codeStudio.editor.say.noProblems'));
    return;
  }
  announce(t('codeStudio.editor.say.problem', { line: view.state.doc.lineAt(head).number, message: hit.message }));
}

/** F8 and Shift+F8. */
export function goToProblem(view: EditorView, direction: 1 | -1): boolean {
  const moved = direction === 1 ? nextDiagnostic(view) : previousDiagnostic(view);
  readOut(view);
  return moved;
}

export const problemExtensions: Extension = [lintGutter()];
