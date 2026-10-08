// Puts a link dragged from a browser onto the page: into the text where it was dropped, or as a new line of text
// when it landed between boxes. One undo step either way.
import type { Editor } from '@tiptap/core';
import { newId } from '../../../editor/ids';
import type { BlockId } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { showInserted } from '../images/insert';
import type { MountedPage } from '../mount';
import { linkMarkdown } from './dropLink';
import type { DroppedLink } from './dropLink';

export async function insertDroppedLink(
  mounted: MountedPage,
  editor: Editor | null,
  after: BlockId | null,
  link: DroppedLink,
): Promise<void> {
  if (mounted.page.readOnly) return;
  if (editor && editor.isEditable) {
    editor
      .chain()
      .insertContent({ type: 'text', text: link.title, marks: [{ type: 'link', attrs: { href: link.href } }] })
      .run();
  } else {
    const block = { id: newId(), type: 'text', data: { markdown: linkMarkdown(link) } };
    const edits = [after ? { edit: 'insertBlock' as const, block, after } : { edit: 'insertBlock' as const, block }];
    const ack = await mounted.sync.send({ edits });
    showInserted(mounted, edits, ack.orderKeys);
  }
  announce(t('pageExtras.attach.linkAdded'));
}
