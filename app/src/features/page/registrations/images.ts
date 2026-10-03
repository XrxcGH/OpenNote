// WP5's registrations for images (PLAN.md section 2, rule 3): Insert image, Crop image, and Alt text. The work
// loads on first use, so this file stays small in the start-up bundle. The image block renderer registers with
// the page view (images/attach.ts), which is in the page chunk.
import { t } from '../../../strings/t';
import { registerAppMenu } from '../../../ui';
import { registerPageCommand } from '../keys';
import { oneImageSelected, shownMedia } from '../images/shown';
import { slashItems } from '../registries';
import { selectOnPage } from '../seams/selectionStore';

const commands = () => import('../images/commands');

registerPageCommand({
  id: 'insert.image',
  title: 'images.insert',
  keywords: 'images.insertKeywords',
  category: 'insert',
  flag: 'page.images',
  when: () => shownMedia.get() !== null,
  run: () => commands().then((module) => module.insertImage()),
});
registerPageCommand({
  id: 'object.crop',
  title: 'images.crop',
  keywords: 'images.cropKeywords',
  category: 'object',
  flag: 'page.images',
  when: oneImageSelected,
  run: () => commands().then((module) => module.cropImage()),
});
registerPageCommand({
  id: 'object.altText',
  title: 'images.altText',
  keywords: 'images.altTextKeywords',
  category: 'object',
  flag: 'page.images',
  when: oneImageSelected,
  run: () => commands().then((module) => module.altText()),
});

slashItems.register({
  id: 'image',
  title: 'images.insert',
  keywords: 'images.insertKeywords',
  icon: 'Image',
  group: 'media',
  order: 10,
  flag: 'page.images',
  command: 'insert.image',
});

// The image's context menu: Crop, Alt text, Copy, and Copy as Markdown. Opening it selects the image.
registerAppMenu('page.image', ({ host }) => {
  const id = host.dataset.blockId;
  if (!id) return null;
  selectOnPage({ blocks: [id], strokes: [] });
  host.focus({ preventScroll: true });
  const run = (what: 'cropImage' | 'altText' | 'copyAsMarkdown') => () =>
    void commands().then((module) => module[what]());
  return {
    label: t('images.toolbar'),
    items: [
      { id: 'crop', label: t('images.crop'), onSelect: run('cropImage') },
      { id: 'altText', label: t('images.altText'), onSelect: run('altText') },
      { id: 'copy', label: t('common.copy'), separatorBefore: true, onSelect: () => document.execCommand('copy') },
      { id: 'copyAsMarkdown', label: t('paste.copyAsMarkdown'), onSelect: run('copyAsMarkdown') },
    ],
  };
});
