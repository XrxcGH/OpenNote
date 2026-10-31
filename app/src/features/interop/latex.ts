// The choices of a LaTeX export (ADR 0054): what the options dialog keeps, how they are remembered on this device, and
// the citation library that goes with them to the host.

import type { LatexOptions, LatexSource } from '../../platform/interop';

/** The choices in the dialog. The citation library is added when the export or the preview runs. */
export type LatexChoices = Omit<LatexOptions, 'citations'>;

export const DEFAULT_LATEX: LatexChoices = {
  engine: 'unicode',
  paper: 'letter',
  margin: 'normal',
  toc: false,
  titleBlock: true,
  author: '',
  date: 'today',
};

const STORAGE_KEY = 'opennote.latexExport';

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.find((one) => one === value) ?? fallback;

/** Reads what the person chose last time on this device. Anything missing or damaged is the default. */
export function loadLatexChoices(): LatexChoices {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return DEFAULT_LATEX;
    const one = saved as Record<string, unknown>;
    return {
      engine: pick(one.engine, ['unicode', 'pdflatex'], DEFAULT_LATEX.engine),
      paper: pick(one.paper, ['letter', 'a4'], DEFAULT_LATEX.paper),
      margin: pick(one.margin, ['narrow', 'normal', 'wide'], DEFAULT_LATEX.margin),
      toc: typeof one.toc === 'boolean' ? one.toc : DEFAULT_LATEX.toc,
      titleBlock: typeof one.titleBlock === 'boolean' ? one.titleBlock : DEFAULT_LATEX.titleBlock,
      author: typeof one.author === 'string' ? one.author.slice(0, 200) : DEFAULT_LATEX.author,
      date: pick(one.date, ['none', 'today', 'edited'], DEFAULT_LATEX.date),
    };
  } catch {
    return DEFAULT_LATEX;
  }
}

export function saveLatexChoices(choices: LatexChoices): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choices));
  } catch {
    // The choices last until the dialog closes.
  }
}

/**
 * The choices with the citation library of the given notebook and the shared list, each source with its BibTeX
 * key. The keys are unique across both lists, so one `.bib` file holds them.
 */
export async function latexOptions(choices: LatexChoices, notebook: string): Promise<LatexOptions> {
  const { bibtexEntries, sourcesOf, SHARED } = await import('../citations');
  const lists = [...new Set([notebook, SHARED])];
  const owned = lists.flatMap((list) => sourcesOf(list).map((source) => ({ list, source })));
  const entries = bibtexEntries(owned.map((one) => one.source));
  const citations: LatexSource[] = entries.map((entry, index) => ({
    notebook: owned[index].list,
    id: entry.id,
    key: entry.key,
    entry: entry.entry,
  }));
  return { ...choices, citations };
}
