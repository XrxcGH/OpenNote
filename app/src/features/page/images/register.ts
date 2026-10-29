// WP5's commands, menus, and settings parts (PLAN.md section 2, rule 3). They are Insert image, Crop image, Alt
// text, Copy as Markdown, the image's context menu, the slash item, and the Paste settings part.
// registrations/images.ts loads this module right after start-up, so none of it counts against the start-up
// bundle. The commands only apply once a page is shown, and their work loads on first use.
import { isEnabled } from '../../../app/flags';
import { executeCommand } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { registerAppMenu } from '../../../ui';
import { registerPageCommand } from '../keys';
import { editingSettingsParts, slashItems } from '../registries';
import { selectOnPage } from '../seams/selectionStore';
import { oneImageSelected, shownMedia } from './shown';

const commands = () => import('./commands');

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

registerPageCommand({
  id: 'edit.copyAsMarkdown',
  title: 'paste.copyAsMarkdown',
  keywords: 'paste.copyAsMarkdownKeywords',
  category: 'editing',
  flag: 'page.editor',
  when: () => shownMedia.get() !== null,
  run: () => commands().then((module) => module.copyAsMarkdown()),
});

editingSettingsParts.register({
  id: 'paste',
  title: 'paste.settings.title',
  order: 60,
  load: () => import('../settings/EditingPaste'),
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
      // Phase 12: text recognition runs on this device, and offers to turn itself on the first time.
      ...(isEnabled('intel.ocr')
        ? [
            {
              id: 'copyText',
              label: t('intel.commands.copyImageText'),
              onSelect: () => void executeCommand('intel.copyImageText', undefined, 'menu'),
            },
          ]
        : []),
    ],
  };
});
