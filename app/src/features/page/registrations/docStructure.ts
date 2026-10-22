// The document-structure tools' registrations: equation numbers and references, the formula sheet, practice mode, and
// the figure exporter. This file loads at start-up, so it holds only definitions; each command loads its code when
// first run. The new-page chooser's built-in templates are in templates/apply.ts.
import { loadEquationCommands } from '../../docstructure';
import { targetEditor } from '../formattingBar/target';
import { addCommand } from './qolStudy';

const withEditor = async (run: (editor: NonNullable<ReturnType<typeof targetEditor>>) => unknown): Promise<void> => {
  const editor = targetEditor();
  if (editor) await run(editor);
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
