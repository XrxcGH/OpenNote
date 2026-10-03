// Saving back (FEATURES.md, Attachments that save back): when the app that opened an attachment saves a change, the
// shell imports the new file as an asset and tells the page. This points the page's attachment at it in one step,
// so Ctrl+Z brings back the version before. When the page closes, the shell stops watching its copies.
import { commandContext } from '../../../commands/registry';
import type { MountedPage } from '../mount';
import { assetTable } from '../images/assets';
import { savedBackEdits } from './model';

export function attachSaveBack(mounted: MountedPage): () => void {
  if (!mounted.host.flag('page.attachments')) return () => undefined;
  let client;
  try {
    client = commandContext('menu').platform.pageExtras;
  } catch {
    return () => undefined;
  }
  const stop = client.onAttachmentSaved((saved) => {
    if (saved.page !== mounted.page.id || mounted.page.readOnly) return;
    const blocks = mounted.layer.blocks();
    const edits = savedBackEdits(blocks, saved);
    if (!edits) return;
    assetTable(mounted.page).add(saved.asset.id, saved.asset.asset);
    void mounted.sync
      .send({ edits })
      .then(() => {
        for (const block of blocks) {
          if (block.type === 'file' && block.data.asset === saved.previous) {
            mounted.layer.upsert({ ...block, data: { ...block.data, asset: saved.asset.id } });
          }
        }
      })
      .catch(() => undefined);
  });
  return () => {
    stop();
    if (mounted.layer.blocks().some((block) => block.type === 'file')) {
      void client.stopAttachments(mounted.page.id).catch(() => undefined);
    }
  };
}
