// A compact outline of a document, for tests: nodes by name with their attributes, text in quotes, and marks as
// wrappers. `paragraph("a", bold("b"))` is a paragraph with a plain word and a bold one.
import type { Node as PMNode } from '@tiptap/pm/model';

const SHOWN = ['level', 'checked', 'start', 'type', 'fold', 'language', 'src', 'alt', 'source'];

function markName(mark: PMNode['marks'][number]): string {
  const detail = mark.attrs.color ?? mark.attrs.href ?? mark.attrs.size ?? '';
  return `${mark.type.name}${String(detail)}`;
}

export function shape(node: PMNode): string {
  if (node.isText) {
    return node.marks.map(markName).reduceRight((inner, name) => `${name}(${inner})`, JSON.stringify(node.text));
  }
  const parts: string[] = [];
  node.forEach((child) => parts.push(shape(child)));
  const attrs = SHOWN.filter(
    (key) => node.attrs[key] !== undefined && node.attrs[key] !== null && node.attrs[key] !== '',
  ).map((key) => `${key}=${String(node.attrs[key])}`);
  const label = node.type.name + (attrs.length > 0 ? `[${attrs.join(',')}]` : '');
  return parts.length > 0 || !node.isLeaf ? `${label}(${parts.join(', ')})` : label;
}
