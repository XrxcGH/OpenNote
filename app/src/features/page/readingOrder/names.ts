// Names by reading order (ARCHITECTURE.md section 7.4; owner WP3). A floating text box's editing root is "Text box
// 2 of 8", counted in reading order. Flowing text is "Page text", or "Page text, part 2 of 3" when tables or
// images split it. Each wrapper is a group whose role description says what it is and whose name is its first
// line, so object mode reads "Light reactions, text box". The same names serve the Reading order pane.
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import type { BlockView } from '../blocks/types';

const floating = (block: BlockJson) => block.frame?.x !== undefined && block.frame?.y !== undefined;

/** A block's first line as plain words, for names and the pane. */
export function summary(block: BlockJson, length = 60): string {
  const markdown = typeof block.data.markdown === 'string' ? block.data.markdown : '';
  const line = markdown.split('\n').find((text) => text.trim() !== '') ?? '';
  const plain = line
    .replace(/^\s*(?:[#>]+|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s*/, '')
    .replace(/[*_`~=]|\[|\]\([^)]*\)|\]/g, '')
    .trim();
  return plain.length > length ? `${plain.slice(0, length - 1)}…` : plain;
}

/** Names the text blocks' editing roots and wrappers, given the blocks in reading order. */
export function nameBlocks(order: readonly BlockJson[], view: (id: string) => BlockView | null): void {
  const boxes = order.filter((block) => block.type === 'text' && floating(block));
  const flowing = order.filter((block) => !floating(block));
  const parts: BlockJson[][] = [];
  for (const block of flowing) {
    if (block.type !== 'text') parts.push([]);
    else if (parts.length === 0 || parts.at(-1)!.length === 0 || parts.at(-1)!.at(-1)!.type !== 'text') {
      parts.push([block]);
    } else parts.at(-1)!.push(block);
  }
  const textParts = parts.filter((part) => part.length > 0);
  for (const block of order) {
    const shown = view(block.id);
    if (!shown || block.type !== 'text') continue;
    let name: string;
    if (floating(block)) {
      name = t('page.block.floatingName', { index: boxes.indexOf(block) + 1, count: boxes.length });
    } else {
      const part = textParts.findIndex((list) => list.includes(block));
      name =
        textParts.length > 1
          ? t('page.block.flowPartName', { index: part + 1, count: textParts.length })
          : t('page.block.flowName');
    }
    shown.editRoot?.setAttribute('aria-label', name);
    shown.element.setAttribute('aria-roledescription', t('page.block.roleText'));
    shown.element.setAttribute('aria-label', summary(block) || name);
  }
}
