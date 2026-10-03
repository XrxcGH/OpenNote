// The Beta 4 additions to search and linking (one registration file for the lane): copy link, line tags and their
// summary, the daily note, collections, the graph, the canvas, and replace. This file loads at start-up, so it holds
// definitions only; the panels and the editor code load when first used.
import { isEnabled } from '../../app/flags';
import { getLocation } from '../../app/location';
import { chord, defineCommand } from '../../commands/registry';
import { commands, contextMenus } from '../../registries';
import { mountedPageHooks } from '../page';
import { copyLinkText } from './deeplink/copy';
import { formatLink } from './deeplink/url';
import { runElementAction } from './elements/events';
import { editorHasFocus } from './links/events';
import { KNOWN_TAGS, tagForSlot } from './lineTags/defs';

function shownPageId(): string | null {
  const here = getLocation();
  return here.view === 'workspace' ? here.pageId : null;
}

// ---- Links to paragraphs -------------------------------------------------------------------------------------------
commands.register(
  defineCommand({
    id: 'search.copyPageLink',
    title: 'qolSearch.commands.copyPageLink',
    keywords: 'qolSearch.commands.keywords.copyPageLink',
    category: 'navigation',
    flag: 'search.paragraphLinks',
    when: (ctx) => ctx.target?.kind === 'node' || shownPageId() !== null,
    run: async (ctx) => {
      const page = ctx.target?.kind === 'node' ? ctx.target.id : shownPageId();
      if (page) await copyLinkText(formatLink(page));
    },
  }),
);

commands.register(
  defineCommand({
    id: 'search.copyParagraphLink',
    title: 'qolSearch.commands.copyParagraphLink',
    keywords: 'qolSearch.commands.keywords.copyParagraphLink',
    category: 'editing',
    scope: 'editor',
    allowInTextInput: true,
    flag: 'search.paragraphLinks',
    when: editorHasFocus,
    run: () => void runElementAction({ type: 'copyLink' }),
  }),
);

contextMenus.register({
  id: 'search.tree.copyLink',
  menu: 'tree.page',
  command: 'search.copyPageLink',
  group: 'share',
  order: 70,
  flag: 'search.paragraphLinks',
});
contextMenus.register({
  id: 'search.text.copyLink',
  menu: 'page.text',
  command: 'search.copyParagraphLink',
  group: 'block',
  order: 30,
  flag: 'search.paragraphLinks',
});

// ---- Line tags -----------------------------------------------------------------------------------------------------
// Ctrl+1 to Ctrl+9 are OneNote's keys, so they belong to the OneNote set; the other set reaches the tags through
// "Tag this line" and the palette.
KNOWN_TAGS.forEach((tag, index) => {
  commands.register(
    defineCommand({
      id: `search.tag.${tag}`,
      title: `qolSearch.commands.tag.${tag}`,
      keywords: 'qolSearch.commands.keywords.tag',
      category: 'editing',
      scope: 'editor',
      presetKeys: { onenote: [chord(`Ctrl+${index + 1}`)] },
      allowInTextInput: true,
      flag: 'search.lineTags',
      when: editorHasFocus,
      run: () => void runElementAction({ type: 'tag', tag: tagForSlot(index + 1) }),
    }),
  );
});

commands.register(
  defineCommand({
    id: 'search.tagLine',
    title: 'qolSearch.commands.tagLine',
    keywords: 'qolSearch.commands.keywords.tag',
    category: 'editing',
    scope: 'editor',
    allowInTextInput: true,
    flag: 'search.lineTags',
    when: editorHasFocus,
    run: () => void runElementAction({ type: 'chooseTag' }),
  }),
);

commands.register(
  defineCommand({
    id: 'search.tagsPane',
    title: 'qolSearch.commands.tagsPane',
    keywords: 'qolSearch.commands.keywords.tagsPane',
    category: 'navigation',
    flag: 'search.lineTags',
    run: () => import('./lineTags/open').then((module) => module.openTagsPane()),
  }),
);

contextMenus.register({
  id: 'search.text.tagLine',
  menu: 'page.text',
  command: 'search.tagLine',
  group: 'block',
  order: 40,
  flag: 'search.lineTags',
});

// ---- Replace across the notebooks ----------------------------------------------------------------------------------
commands.register(
  defineCommand({
    id: 'search.replace',
    title: 'qolSearch.commands.replace',
    keywords: 'qolSearch.commands.keywords.replace',
    category: 'navigation',
    keys: [chord('Ctrl+Shift+H')],
    presetKeys: { onenote: [chord('Ctrl+H')] },
    allowInTextInput: true,
    flag: 'search.replace',
    run: () => import('./replace/open').then((module) => module.openReplace()),
  }),
);

// ---- Page properties -----------------------------------------------------------------------------------------------
// The header joins every page view that mounts. Its code loads with the first one.
mountedPageHooks.register({
  id: 'search.properties',
  attach(mounted) {
    if (!isEnabled('search.properties')) return () => undefined;
    let stop: () => void = () => undefined;
    let gone = false;
    void import('./properties/mount').then((module) => {
      if (!gone) stop = module.mountProperties(mounted);
    });
    return () => {
      gone = true;
      stop();
    };
  },
});
