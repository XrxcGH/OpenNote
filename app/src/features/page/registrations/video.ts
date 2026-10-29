// The registrations for local video files: the Insert video file command and its slash item, the Add captions command,
// the block's renderer, and the drop and paste of mp4 and webm files. This file loads at start-up, so it holds
// definitions only; the block, the player, and the work load on first use.
import { defineCommand } from '../../../commands/registry';
import type { CommandDef } from '../../../commands/types';
import { commandBar, commands, contextMenus } from '../../../registries';
import { t } from '../../../strings/t';
import { blockRenderers, slashItems } from '../registries';
import { shownQueue } from '../sync/shown';
import { lazyBlockView } from '../tables/lazyView';
import { installVideoWatch } from '../video/drop';
import { VIDEO_TYPE } from '../video/model';

const insertId = 'media.insertVideo' as CommandDef['id'];
const captionsId = 'media.videoCaptions' as CommandDef['id'];

commands.register(
  defineCommand({
    id: insertId,
    title: 'video.commands.insert',
    category: 'insert',
    keywords: 'video.commands.insertKeywords',
    flag: 'page.localVideo',
    when: () => shownQueue.get() !== null,
    run: () => import('../video/insert').then((module) => module.insertFromPicker()),
  } as CommandDef),
);

commands.register(
  defineCommand({
    id: captionsId,
    title: 'video.commands.captions',
    category: 'insert',
    keywords: 'video.commands.captionsKeywords',
    flag: 'page.localVideo',
    when: () => shownQueue.get() !== null,
    run: () => import('../video/commands').then((module) => module.captionsForActive()),
  } as CommandDef),
);

slashItems.register({
  id: 'videoFile',
  title: 'video.commands.slash',
  keywords: 'video.commands.insertKeywords',
  icon: 'MonitorPlay',
  group: 'media',
  order: 41,
  flag: 'page.localVideo',
  command: insertId,
});

commandBar.register({
  id: 'video.insert',
  tab: 'insert',
  group: 'blocks',
  command: insertId,
  priority: 40,
  flag: 'page.localVideo',
});

contextMenus.register({
  id: 'page.canvas.insertVideo',
  menu: 'page.canvas',
  command: insertId,
  group: 'insert',
  order: 40,
  flag: 'page.localVideo',
});

blockRenderers.register({
  id: 'video',
  types: [VIDEO_TYPE],
  priority: 1,
  flag: 'page.localVideo',
  create: (block, ctx) =>
    lazyBlockView(block, ctx, () => import('../video/blockRenderer'), t('video.block.unavailable')),
});

installVideoWatch();
