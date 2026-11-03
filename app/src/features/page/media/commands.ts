// The Insert video, podcast, or embed from link command: asks for the link, and puts it on the page if it is one of the
// sites that can be shown. Nothing is fetched from the site until the block is made, and then only its title and picture.
// Any other web address goes in as a normal link, as the dialog says, and text that is no address says so.
import { setLink } from '../../../editor/commands/links';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { askText } from '../../accounts';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync/shown';
import { insertFromLink } from './insert';
import { recognize } from './recognize';

/** Whether the text is a web address: one with a scheme, or a bare host name such as example.com/page. */
export function looksLikeAddress(text: string): boolean {
  if (/\s/.test(text)) return false;
  return /^[a-z][a-z\d+.-]*:\/\/\S+$/i.test(text) || /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(text);
}

/** Puts a link to another site in the text at the caret, or at the end of the page's last text. */
async function insertPlainLink(link: string): Promise<void> {
  const { insertTarget } = await import('../registrations/smart');
  const editor = insertTarget();
  const done = editor?.chain().focus().command(({ state, dispatch }) => setLink(link)(state, dispatch)).run();
  if (!done) return void showToast({ message: t('accounts.media.ask.nowhere') });
  announce(t('accounts.media.ask.linked'));
  showToast({ message: t('accounts.media.ask.linked') });
}

export async function insertFromPrompt(): Promise<void> {
  if (!shownQueue.get()) return void showToast({ message: t('accounts.media.ask.nothing') });
  const link = await askText({
    title: t('accounts.media.ask.title'),
    description: t('accounts.media.ask.description'),
    label: t('accounts.media.ask.label'),
    help: t('accounts.media.ask.help'),
    confirmLabel: t('accounts.media.ask.confirm'),
  });
  if (link === null) return;
  if (!recognize(link)) {
    if (looksLikeAddress(link)) return insertPlainLink(link);
    return void showToast({ message: t('accounts.media.ask.notLink') });
  }
  await insertFromLink(link, shownPool.get()?.active()?.block);
}
