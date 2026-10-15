// A single recognized link pasted into an empty text box becomes an embed block. It decides at once, because it must
// cancel the paste before the text goes in, and loads the rest (the block and the preview) when it takes the paste.
import { isEnabled } from '../../../app/flags';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync/shown';
import { recognize } from './recognize';

export function onPaste(event: ClipboardEvent): void {
  if (!shownQueue.get()) return;
  const text = event.clipboardData?.getData('text/plain');
  const found = text ? recognize(text) : null;
  if (!found || !isEnabled(found.kind === 'live' ? 'page.liveEmbeds' : 'page.mediaEmbeds')) return;
  const active = shownPool.get()?.active();
  if (!active?.editor.isEmpty) return;
  event.preventDefault();
  event.stopPropagation();
  void import('./insert').then((module) => module.insertEmbed(found, active.block));
}
