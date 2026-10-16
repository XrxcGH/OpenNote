// Putting a video, a podcast, or a live embed on the shown page: the block goes in at once with the link, and the
// title and picture follow when the site has answered. The picture is a page asset, so it shows offline.
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { accountsHost } from '../../accounts';
import { insertExtBlock } from '../audio/blocks';
import { shownMounted } from '../pagesApi';
import { shownQueue } from '../sync/shown';
import { shownLayer } from '../mount';
import { dataFor, EMBED_TYPE, fallbackFor } from './model';
import { loadPreview } from './preview';
import { recognize } from './recognize';
import type { Recognized } from './recognize';

/** Whether the kind of embed is turned on. */
export const allowed = (found: Recognized): boolean =>
  found.kind === 'live' ? isEnabled('page.liveEmbeds') : isEnabled('page.mediaEmbeds');

/** Fills the block's title and picture. A block the person deleted meanwhile is left alone. */
export async function fillPreview(block: string, found: Recognized): Promise<void> {
  const mounted = shownMounted.get();
  const queue = shownQueue.get();
  if (!mounted || !queue) return;
  const preview = await loadPreview(accountsHost(), found);
  if (!preview.title && !preview.picture) return;
  if (!shownLayer.get()?.block(block)) return;
  const data: Record<string, unknown> = {};
  const edits: { edit: 'addAsset'; asset: string }[] = [];
  if (preview.title) data.title = preview.title;
  if (preview.picture) {
    const { bytes, mime, name } = preview.picture;
    const copy = bytes.slice().buffer;
    const asset = await mounted.page.importImage({ kind: 'bytes', bytes: copy, name, mime });
    edits.push({ edit: 'addAsset', asset: asset.id });
    data.thumb = asset.id;
  }
  const current = shownLayer.get()?.block(block);
  const title = preview.title ?? (typeof current?.data.title === 'string' ? current.data.title : found.title);
  await queue.send({
    edits: [
      ...edits,
      { edit: 'patchBlock', block, data, fallback: fallbackFor({ title, url: found.url, provider: found.provider }) },
    ],
  });
}

/** Inserts the recognized link as a block after the block with the caret. Resolves the block's ID. */
export async function insertEmbed(found: Recognized, after?: string): Promise<string> {
  const data = dataFor(found);
  const id = await insertExtBlock({ type: EMBED_TYPE, data: { ...data }, fallback: fallbackFor(data) }, after);
  announce(t('accounts.media.ask.confirm'));
  void fillPreview(id, found).catch(() => undefined);
  return id;
}

/** Inserts the link if it is one of the sites. Says why when it isn't. */
export async function insertFromLink(text: string, after?: string): Promise<boolean> {
  const found = recognize(text);
  if (!found) {
    showToast({ message: t('accounts.media.ask.unknown') });
    return false;
  }
  if (!allowed(found)) {
    showToast({ message: t('accounts.media.ask.liveOff') });
    return false;
  }
  await insertEmbed(found, after);
  return true;
}
