// The text Zotero sends for a field: plain text, or the small piece of HTML it uses for formatted citations and
// bibliography entries (italics, bold, superscript, one block per entry). Only the formatting that the page can
// show is kept; links and anything else become their text.

export type Format = 'italic' | 'bold' | 'underline' | 'superscript' | 'subscript';
export interface Piece {
  text: string;
  formats: readonly Format[];
}
export type Paragraph = readonly Piece[];

const TAGS: Record<string, Format> = {
  I: 'italic',
  EM: 'italic',
  B: 'bold',
  STRONG: 'bold',
  U: 'underline',
  SUP: 'superscript',
  SUB: 'subscript',
};
const BLOCKS = new Set(['DIV', 'P', 'LI', 'TR', 'BLOCKQUOTE']);

function styleFormats(element: Element): Format[] {
  const style = (element.getAttribute('style') ?? '').toLowerCase();
  const found: Format[] = [];
  if (/text-decoration[^;]*underline/.test(style)) found.push('underline');
  if (/vertical-align:\s*super/.test(style)) found.push('superscript');
  if (/vertical-align:\s*sub/.test(style)) found.push('subscript');
  if (/font-style:\s*italic/.test(style)) found.push('italic');
  if (/font-weight:\s*(bold|[6-9]00)/.test(style)) found.push('bold');
  return found;
}

/** Plain text as one paragraph per line. */
export function plainParagraphs(text: string): Paragraph[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => [{ text: line, formats: [] }]);
}

function trimmed(pieces: readonly Piece[]): Piece[] {
  const list = pieces.filter((piece) => piece.text !== '').map((piece) => ({ ...piece }));
  if (list.length === 0) return list;
  list[0].text = list[0].text.replace(/^\s+/, '');
  list[list.length - 1].text = list[list.length - 1].text.replace(/\s+$/, '');
  return list.filter((piece) => piece.text !== '');
}

/** Zotero's HTML as paragraphs: one for each bibliography entry (or block), else a single one. */
export function richParagraphs(html: string): Paragraph[] {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  const entries = [...body.querySelectorAll('.csl-entry')];
  const roots = entries.length > 0 ? entries : [body];
  const byBlock = entries.length === 0;
  const out: Piece[][] = [];
  for (const root of roots) {
    let current: Piece[] = [];
    const flush = () => {
      if (
        current
          .map((piece) => piece.text)
          .join('')
          .trim() !== ''
      )
        out.push(trimmed(current));
      current = [];
    };
    const walk = (node: Node, formats: readonly Format[]) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ');
        if (text !== '') current.push({ text, formats });
        return;
      }
      if (!(node instanceof Element)) return;
      if (node.tagName === 'BR') {
        if (byBlock && root === body) flush();
        else current.push({ text: ' ', formats });
        return;
      }
      const own = TAGS[node.tagName];
      const next = [...formats, ...(own ? [own] : []), ...styleFormats(node)];
      const block = byBlock && BLOCKS.has(node.tagName);
      if (block) flush();
      node.childNodes.forEach((child) => walk(child, next));
      if (block) flush();
      // A label before an entry's text (such as "[1]") is kept apart from it.
      else if (typeof node.className === 'string' && node.className.includes('csl-left-margin'))
        current.push({ text: ' ', formats });
    };
    root.childNodes.forEach((child) => walk(child, []));
    flush();
  }
  return out;
}
