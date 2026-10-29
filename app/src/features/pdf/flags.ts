// Flags of the PDF and scan features (docs/FEATURES.md, Phases 11 to 12). Each works from its command to its result.
// They are on in development, nightly, and Beta builds, and wait for a hand test before Stable. app/flags.ts joins
// this list to the others.
import type { FlagDef } from '../../app/flags';

export type PdfFlagId = 'interop.pdfImport' | 'pdf.textLayer' | 'pdf.dim' | 'pdf.highlights' | 'pdf.scan';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const beta = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: PdfFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: beta,
});

export const PDF_FLAGS: readonly FlagDef[] = [
  flag('interop.pdfImport', 'PDF files as pages to write on, note space beside them, and handouts of 2 or 3 per page.'),
  flag('pdf.textLayer', 'Select and copy the words in pictures: PDF pages, and photos and scans the device has read.'),
  flag('pdf.dim', 'Dim or invert PDF pages and slides in the dark theme, with a switch to show the original page.'),
  flag(
    'pdf.scan',
    'Clean up a photo of a page: edges, perspective, lighting, and color, grayscale, or black and white.',
  ),
  flag(
    'pdf.highlights',
    'Highlight words on PDF pages, send them to the notes as quotes, and list them by color and page.',
  ),
];
