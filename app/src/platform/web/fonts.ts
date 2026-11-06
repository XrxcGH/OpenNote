// Fakes of the font list and the notebook styles for the browser and for tests: a fixed list of families, and
// styles kept in memory by notebook. The metrics are round numbers chosen for the fake, not a real font's.

import type { FontFace, FontFamily, FontsClient, NotebookStylesClient, NotebookStylesJson } from '../types';

function face(name: string, weight: number, style: FontFace['style'], monospace: boolean): FontFace {
  const suffix = `${weight === 700 ? 'Bold' : 'Regular'}${style === 'italic' ? 'Italic' : ''}`;
  return {
    postScriptName: `${name.replace(/ /g, '')}-${suffix}`,
    style,
    weight,
    stretch: 5,
    monospace,
    embedding: 'installable',
    unitsPerEm: 1000,
    winAscent: 1000,
    winDescent: 250,
    typoLineGap: 0,
    xHeight: 500,
    capHeight: 700,
  };
}

function family(name: string, generic: FontFamily['generic'], monospace = false): FontFamily {
  return {
    name,
    generic,
    monospace,
    faces: [
      face(name, 400, 'normal', monospace),
      face(name, 400, 'italic', monospace),
      face(name, 700, 'normal', monospace),
      face(name, 700, 'italic', monospace),
    ],
  };
}

/** The fixed list, sorted by name as the shell sorts it. */
export const FAKE_FONTS: readonly FontFamily[] = [
  family('Fake Mono', 'sans-serif', true),
  family('Fake Sans', 'sans-serif'),
  family('Fake Script', 'cursive'),
  family('Fake Serif', 'serif'),
];

export function createWebFonts(): FontsClient {
  return { list: () => Promise.resolve(FAKE_FONTS) };
}

export function createWebNotebookStyles(): NotebookStylesClient {
  const byNotebook = new Map<string, NotebookStylesJson>();
  return {
    get: (notebook) => Promise.resolve(structuredClone(byNotebook.get(notebook) ?? {})),
    set: (notebook, styles) => {
      if (Object.keys(styles).length === 0) byNotebook.delete(notebook);
      else byNotebook.set(notebook, structuredClone(styles));
      return Promise.resolve();
    },
  };
}
