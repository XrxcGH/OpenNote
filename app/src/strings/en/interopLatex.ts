// LaTeX export (ADR 0054): the command, the choices in the Export dialog, and the preview of the .tex file.

export const interopLatex = {
  command: 'Export as LaTeX…',
  keywords: 'latex tex overleaf bibtex xelatex lualatex pdflatex thesis paper article equations references',
  format: 'LaTeX',
  formatHint: 'A .tex file for Overleaf or your own TeX. With pictures or sources, a .zip holds them too.',
  heading: 'LaTeX options',
  engine: {
    label: 'Characters',
    unicode: 'Any language (XeLaTeX or LuaLaTeX)',
    pdflatex: 'Latin letters only (pdfLaTeX)',
    help:
      'The file compiles with any of the three engines. The second choice turns Greek letters and math signs ' +
      'into commands, and shows other characters as question marks.',
  },
  paper: { label: 'Paper size', letter: 'Letter', a4: 'A4' },
  margin: { label: 'Margins', narrow: 'Narrow', normal: 'Normal', wide: 'Wide' },
  titleBlock: 'Add a title, author, and date',
  author: 'Author',
  authorHelp: 'Printed under the title. You can leave it empty.',
  date: {
    label: 'Date',
    none: 'No date',
    today: 'The day you compile',
    edited: 'The day of the last edit',
  },
  toc: 'Add a table of contents',
  note: 'OpenNote only writes the files. It does not compile them, and nothing leaves this PC.',
  preview: {
    heading: 'Preview of the .tex file',
    region: 'Preview of the .tex file',
    loading: 'Updating the preview…',
    unavailable: 'This copy of OpenNote cannot show a preview.',
    failed: 'The preview could not be made. {detail}',
    partial: 'The preview shows only the start of the file.',
  },
} as const;
