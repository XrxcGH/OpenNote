// The Layout commands that change the page or the text block with the caret: columns, vertical text, line numbers, and
// the header and footer dialog. They load on first use; registrations/layout.ts holds only the definitions.
import { createElement } from 'react';
import { applyLayoutPatch, layoutPatch, readLineNumbers, readTextLayout, type TextLayout } from '../../pages';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { openDialog } from '../audio/dialog';
import { shownLayer } from '../mount';
import { shownMounted } from '../pagesApi';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync';
import { HeaderFooterDialog } from './HeaderFooterDialog';

/** The text block with the caret, or null. */
function activeTextBlock(): BlockJson | null {
  const active = shownPool.get()?.active();
  const block = active
    ? shownLayer
        .get()
        ?.blocks()
        .find((b) => b.id === active.block)
    : undefined;
  return block && block.type === 'text' ? block : null;
}

const isFloating = (block: BlockJson): boolean => block.frame?.x !== undefined && block.frame?.y !== undefined;

/** Changes the layout of the text block with the caret. Returns false when there is none. */
export async function changeLayout(change: Partial<TextLayout>): Promise<boolean> {
  const block = activeTextBlock();
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  if (!block || !queue || !layer) return false;
  const patch = layoutPatch(block.data, change);
  await queue.send({ edits: [{ edit: 'patchBlock', block: block.id, data: patch }] });
  layer.upsert({ ...block, data: applyLayoutPatch(block.data, patch) });
  return true;
}

export function setColumns(count: number): boolean {
  if (!activeTextBlock()) {
    announce(t('textLayout.commands.needsText'));
    return false;
  }
  void changeLayout({ columns: count }).then(() =>
    announce(count === 1 ? t('textLayout.announce.oneColumn') : t('textLayout.announce.columns', { count })),
  );
  return true;
}

export function toggleVertical(): boolean {
  const block = activeTextBlock();
  if (!block) {
    announce(t('textLayout.commands.needsText'));
    return false;
  }
  if (!isFloating(block)) {
    announce(t('textLayout.commands.needsFloating'));
    return false;
  }
  const next = !readTextLayout(block.data).vertical;
  void changeLayout({ vertical: next }).then(() =>
    announce(t(next ? 'textLayout.announce.verticalOn' : 'textLayout.announce.verticalOff')),
  );
  return true;
}

/** Turns line numbers in print on with the defaults, or off. */
export function toggleLineNumbers(): void {
  const mounted = shownMounted.get();
  if (!mounted) return;
  const on = readLineNumbers(mounted.layout.view()) !== null;
  mounted.layout.patchView({ text: { lineNumbers: on ? null : {} } });
  announce(t(on ? 'textLayout.commands.lineNumbersOff' : 'textLayout.commands.lineNumbersOn'));
}

export function openHeaderFooter(): Promise<void> {
  const mounted = shownMounted.get();
  if (!mounted) return Promise.resolve();
  return openDialog((close) =>
    createElement(HeaderFooterDialog, {
      view: mounted.layout.view(),
      save: (patch) => mounted.layout.patchView(patch),
      close,
    }),
  );
}
