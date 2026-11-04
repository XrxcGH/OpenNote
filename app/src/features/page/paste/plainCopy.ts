// The plain-text flavor of a copy: the words as they read, with no Markdown marks. A bold word is just the word, a link
// is its text, and an equation is its source. List items keep a dash, a number, or a box, so the shape of a list
// survives in a place that takes only text (SPEC 6.3). The HTML flavor carries the formatting.
import type { Node as PMNode } from '@tiptap/pm/model';

function inlineText(node: PMNode): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) out += child.text ?? '';
    else if (child.type.name === 'hardBreak') out += '\n';
    else if (child.type.name === 'mathInline') out += String(child.attrs.source);
    else if (child.type.name === 'image') out += String(child.attrs.alt);
    else out += child.textContent;
  });
  return out;
}

function indented(lines: string[], prefix: string): string[] {
  const pad = ' '.repeat(prefix.length);
  return lines.map((line, index) => (index === 0 ? prefix : line === '' ? '' : pad) + line);
}

function listLines(list: PMNode): string[] {
  const ordered = list.type.name === 'orderedList';
  let number = ordered ? Number(list.attrs.start) || 1 : 0;
  const lines: string[] = [];
  list.forEach((item) => {
    const checked = item.attrs.checked as boolean | null;
    const marker = ordered ? `${number++}. ` : checked === null ? '- ' : checked ? '[x] ' : '[ ] ';
    lines.push(...indented(blockLines(item), marker));
  });
  return lines;
}

function oneBlock(node: PMNode): string[] {
  const name = node.type.name;
  if (name === 'bulletList' || name === 'orderedList') return listLines(node);
  if (name === 'blockquote' || name === 'callout' || name === 'listItem') return blockLines(node);
  if (name === 'horizontalRule') return ['---'];
  if (name === 'mathBlock') return [String(node.attrs.source)];
  return (node.isTextblock ? inlineText(node) : node.textContent).split('\n');
}

function blockLines(parent: PMNode): string[] {
  const lines: string[] = [];
  parent.forEach((node) => lines.push(...oneBlock(node)));
  return lines;
}

/** The text of a document as it reads: list markers and paragraphs, a blank line between blocks, no Markdown marks. */
export function plainCopy(doc: PMNode): string {
  const blocks: string[] = [];
  doc.forEach((node) => blocks.push(oneBlock(node).join('\n')));
  return blocks.join('\n\n');
}
