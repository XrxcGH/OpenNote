// Inline images inside text (ARCHITECTURE.md section 8.2; owner: WP4). The atom keeps what it parsed, and the
// editor never loads its source. An image from outside the page shows as a chip with its description (SPEC 7.3).
// An `asset:` image shows the same chip, marked with its asset ID, until the page resolves assets for it.
import type { Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import type { EditorHost } from '../host';
import { ImageNode } from '../schema/nodes';
import styles from './content.module.css';

class ImageChipView implements NodeView {
  dom: HTMLSpanElement;

  constructor(private node: PMNode) {
    this.dom = document.createElement('span');
    this.dom.className = styles.imageChip;
    this.dom.setAttribute('role', 'img');
    this.render();
  }

  private render(): void {
    const { src, alt } = this.node.attrs as { src: string; alt: string };
    const label = alt ? t('editor.image.chip', { alt }) : t('editor.image.chipUnnamed');
    this.dom.setAttribute('aria-label', label);
    this.dom.textContent = alt || t('editor.image.chipText');
    if (src.startsWith('asset:')) this.dom.dataset.asset = src.slice('asset:'.length);
    else delete this.dom.dataset.asset;
    this.dom.title = src.startsWith('asset:') ? label : t('editor.image.notLoaded', { src });
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

export function imageExtensions(_host: EditorHost): Extensions {
  return [
    ImageNode.extend({
      addNodeView:
        () =>
        ({ node }) =>
          new ImageChipView(node),
    }),
  ];
}
