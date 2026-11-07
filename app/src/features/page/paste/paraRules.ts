// Paragraph formatting from the clipboard (ADR 0084). The schema's paragraph attributes are never read from pasted
// HTML, so a web page can't set them. Keep source formatting and OpenNote's own copy carry them in one JSON
// attribute instead, and these two rules, tried before the schema's, read it through the file format's own checks.
// A value that fails them is ignored.
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import type { ParseRule } from '@tiptap/pm/model';
import { PARA_DATA } from '../../../editor/clipboard/paraData';
import { portableFormat } from '../../../editor/clipboard/style';
import { textSchema } from '../../../editor/schema/schema';

const MAX_JSON = 4096;

/** The checked paragraph attributes in an element's `data-paste-para`, or null when it has none worth keeping. */
export function readParaData(element: Element): Record<string, unknown> | null {
  const text = element.getAttribute(PARA_DATA);
  if (!text || text.length > MAX_JSON) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const format = portableFormat(parsed as Record<string, unknown>);
  return Object.keys(format).length > 0 ? format : null;
}

const RULES: readonly ParseRule[] = [
  {
    tag: `p[${PARA_DATA}]`,
    priority: 60,
    node: 'paragraph',
    getAttrs: (element) => readParaData(element as Element) ?? false,
  },
  ...[1, 2, 3, 4, 5, 6].map((level): ParseRule => ({
    tag: `h${level}[${PARA_DATA}]`,
    priority: 60,
    node: 'heading',
    getAttrs: (element) => {
      const format = readParaData(element as Element);
      return format ? { level, ...format } : false;
    },
  })),
];

let parser: PMDOMParser | null = null;

/** The paste parser: the schema's rules, with the paragraph formatting rules first. */
export function pasteParser(): PMDOMParser {
  parser ??= new PMDOMParser(textSchema, [...RULES, ...PMDOMParser.fromSchema(textSchema).rules]);
  return parser;
}
