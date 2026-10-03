// Code editors (Phase 4 ARCHITECTURE.md section 15.3): VS Code and its kin copy monospace spans in a `pre`-styled
// block, beside the plain text. The text is what counts: several lines make a code block, and one line is inline code.
import type { Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../../../../editor/schema/schema';
import type { PastedPiece } from '../types';

const { nodes, marks } = textSchema;

/** The language VS Code names in its `vscode-editor-data` item, if a caller has it. */
export function codePieces(text: string, language: string | null = null): PastedPiece[] {
  const source = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (source.trim() === '') return [];
  const block: PMNode = source.includes('\n')
    ? nodes.codeBlock.create({ language }, textSchema.text(source))
    : nodes.paragraph.create(null, textSchema.text(source, [marks.code.create()]));
  return [{ kind: 'text', doc: nodes.doc.create(null, block) }];
}

/** The text a code editor's HTML holds, when the plain text is missing. */
export function codeText(body: HTMLElement): string {
  body.querySelectorAll('br').forEach((br) => br.replaceWith(br.ownerDocument.createTextNode('\n')));
  const lines = [...body.querySelectorAll(':scope > div > div, :scope > div > p')];
  return lines.length > 1 ? lines.map((line) => line.textContent ?? '').join('\n') : (body.textContent ?? '');
}
