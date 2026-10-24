// Zotero fields on a page (Citation helper). A field is text that carries a link mark whose address holds Zotero's
// field code, so it survives saving as Markdown, copying, and undo with no new kind of node. The address is inert:
// OpenNote keeps it and never opens it. A citation is an inline run of such text, and a bibliography is whole
// paragraphs of it. Zotero reads and writes the code; nothing here reads inside it, except to tell a bibliography
// (a code starting BIBL) from a citation.
import type { Node as PMNode } from '@tiptap/pm/model';

export const FIELD_PREFIX = 'zotero:field/';
/** The code a field has between being inserted and Zotero giving it its own. */
export const TEMP_CODE = 'TEMP ';

export const isFieldHref = (href: unknown): href is string => typeof href === 'string' && href.startsWith(FIELD_PREFIX);

export function encodeCode(code: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(code)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCode(text: string): string {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return '';
  }
}

export const hrefFor = (code: string): string => FIELD_PREFIX + encodeCode(code);
export const codeOf = (href: string): string => decodeCode(href.slice(FIELD_PREFIX.length));
export const isBibliographyCode = (code: string): boolean => /^BIBL\b/.test(code);

export interface Field {
  href: string;
  code: string;
  /** For a citation, the text's start. For a bibliography of whole paragraphs, just before the first one. */
  from: number;
  /** The matching end: after the text, or just after the last paragraph. */
  to: number;
  /** The field is whole paragraphs. */
  block: boolean;
}

interface Run {
  href: string;
  from: number;
  to: number;
  whole: boolean;
  before: number;
  after: number;
}

const linkHref = (node: PMNode): string | null => {
  const mark = node.marks.find((one) => one.type.name === 'link');
  const href: unknown = mark?.attrs.href;
  return isFieldHref(href) ? href : null;
};

/** Every Zotero field in the document, in order. */
export function listFields(doc: PMNode): Field[] {
  const runs: Run[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    const mine: Run[] = [];
    let open: Run | null = null;
    node.forEach((child, offset) => {
      const href = child.isText ? linkHref(child) : null;
      const at = start + offset;
      if (href && open && open.href === href && open.to === at) open.to = at + child.nodeSize;
      else if (href) {
        open = { href, from: at, to: at + child.nodeSize, whole: false, before: pos, after: pos + node.nodeSize };
        mine.push(open);
      } else open = null;
    });
    for (const run of mine) run.whole = run.from === start && run.to === start + node.content.size;
    runs.push(...mine);
    return false;
  });
  const fields: Field[] = [];
  for (const run of runs) {
    const code = codeOf(run.href);
    const last = fields[fields.length - 1];
    if (isBibliographyCode(code) && run.whole) {
      if (last?.block && last.href === run.href && last.to === run.before) {
        last.to = run.after;
        continue;
      }
      fields.push({ href: run.href, code, from: run.before, to: run.after, block: true });
    } else fields.push({ href: run.href, code, from: run.from, to: run.to, block: false });
  }
  return fields;
}
