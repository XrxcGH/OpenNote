// Putting local videos on the shown page, and captions on a video. Each file is checked (its name and type, its size,
// and its first bytes) before the shell stores it as an asset of the page. Nothing is read from the network; the
// video plays from the page's own asset address.
import { commandContext } from '../../../commands/registry';
import type { PageExtrasClient } from '../../../platform/types';
import type { BlockId, Edit } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { insertExtBlock } from '../audio/blocks';
import { shownLayer } from '../mount';
import { shownMounted } from '../pagesApi';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync/shown';
import { bytesMatch, isCaptionFile, isWebVtt, MAX_CAPTION_BYTES, MAX_VIDEO_BYTES, videoMimeOf } from './kinds';
import { dataFor, fallbackFor, VIDEO_TYPE, videoDataOf } from './model';

function native(): PageExtrasClient | null {
  try {
    return commandContext('menu').platform.pageExtras;
  } catch {
    return null;
  }
}

/** Why a video file is refused, or null when it may be added. Reads the first bytes of the file. */
export async function refusal(file: File): Promise<string | null> {
  const mime = videoMimeOf(file);
  if (!mime) return t('video.insert.notVideo', { name: file.name });
  if (file.size > MAX_VIDEO_BYTES) {
    return t('video.insert.tooLarge', { name: file.name, limit: Math.round(MAX_VIDEO_BYTES / (1024 * 1024)) });
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return bytesMatch(head, mime) ? null : t('video.insert.damaged', { name: file.name });
}

/** Adds the files as video blocks after the block with the caret. Answers the new blocks' IDs. */
export async function insertVideoFiles(files: readonly File[], after?: BlockId): Promise<BlockId[]> {
  const mounted = shownMounted.get();
  if (!mounted || !shownQueue.get()) {
    showToast({ message: t('video.insert.nothing') });
    return [];
  }
  const client = native();
  if (!client) {
    showToast({ message: t('video.insert.needsApp') });
    return [];
  }
  const ids: BlockId[] = [];
  let place = after ?? shownPool.get()?.active()?.block;
  for (const file of files) {
    const why = await refusal(file);
    if (why) {
      showToast({ message: why, tone: 'danger' });
      continue;
    }
    try {
      const mime = videoMimeOf(file) ?? 'video/mp4';
      const asset = await client.attachBytes(mounted.page.id, await file.arrayBuffer(), file.name, mime);
      const id = await insertExtBlock(
        { type: VIDEO_TYPE, data: { ...dataFor(asset.id, file.name) }, fallback: fallbackFor(file.name) },
        place,
        [{ edit: 'addAsset', asset: asset.id }],
      );
      ids.push(id);
      place = id;
      announce(t('video.insert.done', { name: file.name }));
    } catch {
      showToast({ message: t('video.insert.failed', { name: file.name }), tone: 'danger' });
    }
  }
  return ids;
}

/** Asks for files with the system picker. */
function pick(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

/** The Insert video file command. */
export async function insertFromPicker(): Promise<void> {
  const files = await pick('video/mp4,video/webm,.mp4,.m4v,.webm', true);
  if (files.length > 0) await insertVideoFiles(files);
}

/** Why a caption file is refused, or null when it may be added. */
export async function captionRefusal(file: File): Promise<string | null> {
  if (!isCaptionFile(file)) return t('video.captions.notCaptions', { name: file.name });
  if (file.size > MAX_CAPTION_BYTES) return t('video.captions.tooLarge', { name: file.name });
  return isWebVtt(await file.slice(0, 16).text()) ? null : t('video.captions.notCaptions', { name: file.name });
}

/** Asks for a .vtt file and sets it as the captions of the video block. Replaces the captions it had. */
export async function setCaptions(block: BlockId, file?: File): Promise<void> {
  const mounted = shownMounted.get();
  const queue = shownQueue.get();
  const current = shownLayer.get()?.block(block);
  const data = current ? videoDataOf(current) : null;
  if (!mounted || !queue || !data) return void showToast({ message: t('video.insert.nothing') });
  const client = native();
  if (!client) return void showToast({ message: t('video.insert.needsApp') });
  const chosen = file ?? (await pick('.vtt,text/vtt', false))[0];
  if (!chosen) return;
  const why = await captionRefusal(chosen);
  if (why) return void showToast({ message: why, tone: 'danger' });
  try {
    const asset = await client.attachBytes(mounted.page.id, await chosen.arrayBuffer(), chosen.name, 'text/vtt');
    const edits: Edit[] = [
      { edit: 'addAsset', asset: asset.id },
      {
        edit: 'patchBlock',
        block,
        data: { captions: asset.id, captionsName: chosen.name },
        fallback: fallbackFor(data.name),
      },
    ];
    await queue.send({ edits });
    announce(t('video.captions.added', { name: data.name }));
  } catch {
    showToast({ message: t('video.insert.failed', { name: chosen.name }), tone: 'danger' });
  }
}

/** Takes the captions off the video block. */
export async function removeCaptions(block: BlockId): Promise<void> {
  const queue = shownQueue.get();
  const current = shownLayer.get()?.block(block);
  const data = current ? videoDataOf(current) : null;
  if (!queue || !data) return;
  await queue.send({
    edits: [{ edit: 'patchBlock', block, data: { captions: '', captionsName: '' }, fallback: fallbackFor(data.name) }],
  });
  announce(t('video.captions.removed', { name: data.name }));
}
