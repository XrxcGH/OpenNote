// Copy link: the text goes to the clipboard, and a toast says so, because a copy has no other sign.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';

export async function copyLinkText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    announce(t('qolSearch.links.copied'));
    showToast({ message: t('qolSearch.links.copied') });
    return true;
  } catch {
    showToast({ message: t('qolSearch.links.copyFailed'), tone: 'danger' });
    return false;
  }
}
