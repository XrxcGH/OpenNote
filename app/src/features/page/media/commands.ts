// The Insert video, podcast, or embed from link command: asks for the link, and puts it on the page if it is one of the
// sites that can be shown. Nothing is fetched from the site until the block is made, and then only its title and picture.
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { askText } from '../../accounts';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync/shown';
import { insertFromLink } from './insert';

export async function insertFromPrompt(): Promise<void> {
  if (!shownQueue.get()) return void showToast({ message: t('accounts.media.ask.nothing') });
  const link = await askText({
    title: t('accounts.media.ask.title'),
    description: t('accounts.media.ask.description'),
    label: t('accounts.media.ask.label'),
    help: t('accounts.media.ask.help'),
    confirmLabel: t('accounts.media.ask.confirm'),
  });
  if (!link) return;
  await insertFromLink(link, shownPool.get()?.active()?.block);
}
