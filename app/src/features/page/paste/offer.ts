// The Paste Options chip (ADR 0084). After a paste that had a formatting choice to make, a notice says which one it
// used and offers the other two. Choosing one replaces the pasted text in one transaction, which is one undo step:
// the page closes its undo step after it. The chip lasts while the page is as the paste left it; any edit ends it.
import { Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { t } from '../../../strings/t';
import { announce, openMenu, showToast } from '../../../ui';
import type { PasteChoice } from './types';

export const PASTE_CHOICES: readonly PasteChoice[] = ['keepSource', 'mergeFormatting', 'textOnly'];

const LABEL = {
  keepSource: 'textPaste.keepSource',
  mergeFormatting: 'textPaste.mergeFormatting',
  textOnly: 'textPaste.textOnly',
} as const;

export interface PasteOffer {
  readonly editor: Editor;
  /** The pasted text's range in the editor. */
  readonly from: number;
  readonly to: number;
  readonly choice: PasteChoice;
  /** The text piece the paste makes under a choice, or null when the choice gives nothing. */
  rebuild(choice: PasteChoice): PMNode | null;
  /** Closes the page's undo step, so the switch is its own. */
  settle(): Promise<void>;
}

/** The editor's document as the paste left it, by offer, so an edit since then ends the chip. */
const left = new WeakMap<PasteOffer, PMNode>();

/** Whether the offer still holds: nothing has changed in the page since the paste. */
export function offerHolds(offer: PasteOffer): boolean {
  return !offer.editor.isDestroyed && left.get(offer) === offer.editor.state.doc;
}

/**
 * Replaces the pasted text with what another choice gives, as one transaction. Returns the new offer, or null when
 * the page changed since the paste or the choice gives no text.
 */
export async function switchChoice(offer: PasteOffer, choice: PasteChoice): Promise<PasteOffer | null> {
  if (!offerHolds(offer) || choice === offer.choice) return null;
  const doc = offer.rebuild(choice);
  if (!doc) return null;
  const { editor } = offer;
  const slice = Slice.maxOpen(editor.schema.nodeFromJSON(doc.toJSON()).content);
  const tr = editor.state.tr.replace(offer.from, offer.to, slice);
  const to = tr.mapping.map(offer.to, 1);
  editor.view.dispatch(tr);
  const next: PasteOffer = { ...offer, to, choice };
  left.set(next, editor.state.doc);
  await offer.settle();
  return next;
}

async function choose(offer: PasteOffer, dismiss: () => void): Promise<void> {
  if (!offerHolds(offer)) {
    dismiss();
    announce(t('textPaste.ended'));
    return;
  }
  const at = offer.editor.view.coordsAtPos(offer.to);
  const items = PASTE_CHOICES.map((choice) => ({
    id: choice,
    label: t(LABEL[choice]),
    kind: 'radio' as const,
    checked: choice === offer.choice,
  }));
  const picked = await openMenu({ label: t('textPaste.menu'), items, anchor: { x: at.left, y: at.bottom } });
  if (!picked || picked === offer.choice) return;
  const next = await switchChoice(offer, picked as PasteChoice);
  if (next) {
    announce(t('textPaste.switched', { choice: t(LABEL[next.choice]) }));
    offerPasteOptions(next);
  }
}

/** Shows the chip for a paste. */
export function offerPasteOptions(offer: PasteOffer): void {
  left.set(offer, offer.editor.state.doc);
  const shown: { dismiss?: () => void } = {};
  shown.dismiss = showToast({
    id: 'page.pasteOptions',
    message: t('textPaste.chip', { choice: t(LABEL[offer.choice]) }),
    action: { label: t('textPaste.options'), run: () => choose(offer, () => shown.dismiss?.()) },
  }).dismiss;
}
