// Flags for the document-structure tools: equation numbers, the formula sheet, practice mode, problem-set templates,
// and the figure exporter. Each is on in every channel once its feature works end to end.
import type { FlagDef } from '../../app/flags';

export type DocFlagId =
  'doc.equationNumbers' | 'doc.formulaSheet' | 'doc.practice' | 'doc.problemTemplates' | 'doc.figureExport';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: DocFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: on,
});

export const DOC_FLAGS: readonly FlagDef[] = [
  flag('doc.equationNumbers', 'Numbered display equations and references to them that follow when equations move.'),
  flag('doc.formulaSheet', 'A one-page formula sheet built from the equations of chosen pages.'),
  flag('doc.practice', 'Practice mode for worked problems: steps hidden, then shown one at a time.'),
  flag('doc.problemTemplates', 'Problem set, Cornell notes, and lab report templates in the new-page chooser.'),
  flag('doc.figureExport', 'Export a graph or diagram as a numbered, captioned SVG or PNG picture.'),
];
