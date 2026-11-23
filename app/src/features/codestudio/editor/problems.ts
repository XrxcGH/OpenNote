// Showing problems (DESIGN 6.2): squiggles, gutter marks, hover with fixes, and F8 and Shift+F8 to move to the next
// and previous problem, which also reads it out. Lane code:L10 finds the problems; this only shows them.

import {
  forEachDiagnostic,
  lintGutter,
  nextDiagnostic,
  openLintPanel,
  previousDiagnostic,
  setDiagnostics,
} from '@codemirror/lint';
import type { Action, Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { t } from '../../../strings/t';
import { announce } from '../../../ui/announce';
import type { Diagnostic, Fix } from '../contracts';
import type { EditorLanguage } from './indent';
import { explain, type ExplainLanguage } from '../explain';
import { fixMenu, type FixContext } from '../fixes';
import { inDocument } from './ghost';

/** Every edit of the fix lies in a document of `length`, so applying it cannot throw. */
function fits(fix: Fix, length: number): boolean {
  return fix.edits.every(({ from, to }) => inDocument(from, length) && inDocument(to, length) && from <= to);
}

const EXPLAINED: ReadonlySet<string> = new Set(['python', 'javascript', 'typescript', 'c', 'cpp', 'sql', 'lua']);

/** The "Explain this problem" menu entry: it reads the plain-language explanation out and shows it as a status. */
function explainAction(item: Diagnostic, language: EditorLanguage): Action | null {
  if (!EXPLAINED.has(language)) return null;
  return {
    name: t('codeStudio.fixes.explainAction'),
    apply: (v: EditorView) => {
      const head = v.state.selection.main.head;
      const lineNumber = v.state.doc.lineAt(head).number;
      const line = v.state.doc.line(Math.min(lineNumber, v.state.doc.lines));
      const e = explain({
        language: language as ExplainLanguage,
        message: item.message,
        line: line.number,
        lineText: line.text,
      });
      announce(t('codeStudio.editor.say.explained', { text: `${e.what} ${e.cause} ${e.next}` }));
    },
  };
}

function toCodeMirror(item: Diagnostic, length: number, language?: EditorLanguage): CmDiagnostic {
  const from = Math.max(0, Math.min(item.from, length));
  return {
    from,
    to: Math.max(from, Math.min(item.to, length)),
    severity: item.severity,
    source: item.source,
    message: item.code ? `${item.message} (${item.code})` : item.message,
    actions: (item.fixes ?? [])
      .filter((fix) => fits(fix, length))
      .map((fix): Action => ({
        name: fix.title,
        apply: (view: EditorView) => {
          // The text may have changed since the problems came in: a fix that no longer fits does nothing.
          if (!fits(fix, view.state.doc.length)) return;
          view.dispatch({
            changes: fix.edits.map(({ from: a, to, insert }) => ({ from: a, to, insert })),
            userEvent: 'input.fix',
          });
        },
      }))
      .concat(language ? [explainAction(item, language)].filter((a): a is Action => a !== null) : []),
  };
}

/**
 * Shows a file's problems, replacing the ones shown before. With a context the problems first get their quick fixes
 * (fixMenu, DESIGN 7.1) and an Explain entry, so the hover menu, the lightbulb, and Ctrl+. offer them.
 */
export function showProblems(view: EditorView, items: readonly Diagnostic[], ctx?: Omit<FixContext, 'text'>): void {
  const length = view.state.doc.length;
  const withFixes = ctx ? fixMenu(items, { ...ctx, text: view.state.doc.toString() }).items : items;
  view.dispatch(
    setDiagnostics(
      view.state,
      withFixes.map((item) => toCodeMirror(item, length, ctx?.language)),
    ),
  );
}

function problemAt(view: EditorView): CmDiagnostic | null {
  const head = view.state.selection.main.head;
  let found: CmDiagnostic | null = null;
  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    if (!found && from <= head && head <= to) found = diagnostic;
  });
  return found as CmDiagnostic | null;
}

/** Ctrl+.: the quick fixes of the problem at the caret, in the problems list where each one is a button. */
export function showFixes(view: EditorView): boolean {
  const hit = problemAt(view);
  const fixes = (hit?.actions ?? []).filter((a) => a.name !== t('codeStudio.fixes.explainAction'));
  if (!hit || fixes.length === 0) {
    announce(t('codeStudio.editor.say.noFix'));
    return false;
  }
  return openLintPanel(view);
}

/** Explains the problem at the caret in plain words. */
export function explainProblem(view: EditorView): boolean {
  const action = problemAt(view)?.actions?.find((a) => a.name === t('codeStudio.fixes.explainAction'));
  if (!action) {
    announce(t('codeStudio.editor.say.noProblems'));
    return false;
  }
  action.apply(view, 0, 0);
  return true;
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
