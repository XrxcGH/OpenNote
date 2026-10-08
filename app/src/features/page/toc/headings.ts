// The table of contents: the headings of a typed page, in reading order. A heading
// is a heading node of a text box; its text is what the page shows, without formatting marks.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { BlockId } from '../../../services/pages/types';
import { liveText } from '../blocks/textBlock';
import type { MountedPage } from '../mount';

export interface Heading {
  block: BlockId;
  /** Which heading of its box this is, counting from 0. */
  index: number;
  level: number;
  text: string;
  /** The position of the heading node in its box's document. */
  pos: number;
}

/** The headings of one document, in order. */
export function headingsOfDoc(doc: PMNode): Omit<Heading, 'block'>[] {
  const found: Omit<Heading, 'block'>[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = Number(node.attrs.level);
      found.push({
        index: found.length,
        level: level >= 1 && level <= 6 ? level : 1,
        text: node.textContent.trim(),
        pos,
      });
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}

/** Every heading on the page, in reading order. Empty headings are left out: they have nothing to name. */
export function pageHeadings(mounted: MountedPage): Heading[] {
  const out: Heading[] = [];
  for (const block of mounted.layer.blocks()) {
    if (block.type !== 'text') continue;
    const live = liveText(mounted.layer.view(block.id));
    if (!live) continue;
    for (const heading of headingsOfDoc(live.liveDoc())) {
      if (heading.text !== '') out.push({ ...heading, block: block.id });
    }
  }
  return out;
}

/** The smallest level in the list, so the outline starts at the left edge however it begins. */
export function topLevel(headings: readonly Pick<Heading, 'level'>[]): number {
  return headings.reduce((least, heading) => Math.min(least, heading.level), 6);
}

/** Moves the caret to a heading and brings it to the top of the view. */
export function goToHeading(mounted: MountedPage, heading: Heading): void {
  const editor = mounted.pool.mount(
    heading.block,
    { kind: 'selection', anchor: heading.pos + 1, head: heading.pos + 1 },
    'target',
  );
  const element = editor?.view.nodeDOM(heading.pos);
  if (element instanceof HTMLElement) element.scrollIntoView({ block: 'start' });
}
