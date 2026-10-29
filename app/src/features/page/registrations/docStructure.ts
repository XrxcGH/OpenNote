// The document-structure tools' registrations: equation numbers and references, the formula sheet, practice mode, and
// the figure exporter. This file loads at start-up, so it holds only definitions; each command loads its code when
// first run. The new-page chooser's built-in templates are in templates/apply.ts.
import type { Editor } from '@tiptap/core';
import { loadEquationCommands } from '../../docstructure';
import { t } from '../../../strings/t';
import { targetEditor } from '../formattingBar/target';
import { addCommand } from './qolStudy';
import { say } from './say';

// The palette takes focus before these commands run, so the editor that had focus last is remembered here: the target
// editor knows it only once it is watching, and this does not depend on when that starts.
let lastEditor: Editor | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    () => {
      const editor = targetEditor();
      if (editor) lastEditor = editor;
    },
    true,
  );
}

const withEditor = async (run: (editor: Editor) => unknown): Promise<void> => {
  const editor = targetEditor() ?? (lastEditor && !lastEditor.isDestroyed && lastEditor.isEditable ? lastEditor : null);
  // Without a text block to work in, say so: a button that does nothing looks broken.
  if (editor) await run(editor);
  else say(t('docStructure.eq.needsText'));
};

addCommand({
  id: 'doc.equation.number',
  title: 'docStructure.eq.number',
  keywords: 'docStructure.eq.numberKeywords',
  icon: 'ListNumbers',
  flag: 'doc.equationNumbers',
  bar: { group: 'math', priority: 40 },
  run: () => withEditor(async (editor) => (await loadEquationCommands()).numberEquation(editor)),
});
addCommand({
  id: 'doc.equation.numberAll',
  title: 'docStructure.eq.numberAll',
  keywords: 'docStructure.eq.numberAllKeywords',
  icon: 'ListNumbers',
  flag: 'doc.equationNumbers',
  category: 'editing',
  run: () => withEditor(async (editor) => (await loadEquationCommands()).numberAllEquations(editor)),
});
addCommand({
  id: 'doc.equation.unnumber',
  title: 'docStructure.eq.unnumber',
  keywords: 'docStructure.eq.unnumberKeywords',
  icon: 'ListNumbers',
  flag: 'doc.equationNumbers',
  category: 'editing',
  run: () => withEditor(async (editor) => (await loadEquationCommands()).unnumberEquation(editor)),
});
addCommand({
  id: 'doc.equation.reference',
  title: 'docStructure.eq.ref',
  keywords: 'docStructure.eq.refKeywords',
  icon: 'ArrowBendUpRight',
  flag: 'doc.equationNumbers',
  slash: { group: 'advanced', order: 53 },
  bar: { group: 'math', priority: 39 },
  run: () => withEditor(async (editor) => (await loadEquationCommands()).insertReference(editor)),
});

// Tool windows: the formula sheet builder, practice mode, and the figure exporter open from the palette and the Tools
// group of the Insert tab.
for (const [tool, flag, title, keywords, icon, priority] of [
  ['formulasheet', 'doc.formulaSheet', 'docStructure.sheet.open', 'docStructure.sheet.keywords', 'Sigma', 38],
  ['practice', 'doc.practice', 'docStructure.practice.open', 'docStructure.practice.keywords', 'Eye', 37],
  ['figure', 'doc.figureExport', 'docStructure.figure.open', 'docStructure.figure.keywords', 'ImageSquare', 36],
] as const) {
  addCommand({
    id: `tools.${tool}`,
    title,
    keywords,
    category: 'general',
    icon,
    flag,
    anywhere: true,
    bar: { group: 'math', priority },
    run: async () => (await import('../../tools')).openTool(tool),
  });
}
