// Following a [[page link]]: it opens the page it points at. A link to nothing offers to make the page, so a
// link written first and a page made later is a short step.
import { isEnabled } from '../../../app/flags';
import { getLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import type { NodeId } from '../../../services/notes/types';
import type { LinkRef } from '../../../services/search/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { openAndReveal } from '../deeplink/jump';
import { locationOfPage, openPage } from '../locate';
import { resolveNow } from './resolver';

/** Makes a page with this title at the end of the section that is open, and opens it. */
export async function createLinkedPage(title: string): Promise<boolean> {
  const { notes, navigate } = commandContext('palette');
  const here = getLocation();
  if (here.view !== 'workspace' || !here.sectionId) return false;
  try {
    const page = await notes.create({
      kind: 'page',
      placement: { parentId: here.sectionId as NodeId, beforeId: null },
      title,
    });
    const to = await locationOfPage(notes, page.id);
    if (to) navigate(to, { focus: 'target' });
    announce(t('search.links.created', { title: page.title }));
    return true;
  } catch {
    showToast({ message: t('search.links.createFailed', { title }), tone: 'danger' });
    return false;
  }
}

/** Opens the page a link points at. Returns false when it points at nothing. */
export async function followLink(link: LinkRef): Promise<boolean> {
  const { notes } = commandContext('palette');
  const answer = await resolveNow(link);
  const target = answer?.targets[0];
  if (target) {
    // A link to a heading jumps to it; a link to a page opens the page.
    if (isEnabled('search.paragraphLinks') && target.block) await openAndReveal(notes, target.page, target.block);
    else await openPage(notes, target.page);
    return true;
  }
  showToast({
    message: t('search.links.broken', { title: link.title }),
    action: { label: t('search.links.create'), run: () => void createLinkedPage(link.title) },
  });
  return false;
}
