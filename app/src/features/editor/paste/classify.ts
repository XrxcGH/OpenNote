// Which program a paste came from, told from its HTML (Phase 4 design, 15.3). The signs are the ones each program
// writes into the clipboard: Word and Excel name themselves in the header, OneNote in its ProgId, Google Docs in
// the wrapper's ID, and VS Code in a preformatted monospace block.
import type { PasteSource } from './types';

const GOOGLE_DOCS = /id=["']?docs-internal-guid-/i;
const ONENOTE = /ProgId["']?\s+content=["']?OneNote|Microsoft OneNote/i;
const EXCEL = /urn:schemas-microsoft-com:office:excel|ProgId["']?\s+content=["']?Excel/i;
const WORD = /urn:schemas-microsoft-com:office:word|ProgId["']?\s+content=["']?Word|class=["']?Mso/i;
const PREFORMATTED = /white-space\s*:\s*pre\b/i;
const MONOSPACE = /monospace|consolas|menlo|courier/i;
const STRUCTURE = /<(?:p|h[1-6]|ul|ol|li|table|blockquote)\b/i;

/** The source of an HTML paste. Anything that is not one of the known programs is a web page. */
export function classifyHtml(html: string): PasteSource {
  if (GOOGLE_DOCS.test(html)) return 'gdocs';
  if (ONENOTE.test(html)) return 'onenote';
  if (EXCEL.test(html)) return 'excel';
  if (WORD.test(html)) return 'word';
  if (PREFORMATTED.test(html) && MONOSPACE.test(html) && !STRUCTURE.test(html)) return 'vscode';
  return 'web';
}
