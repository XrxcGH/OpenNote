// Joins the English namespaces. Each namespace file has one owner, so parallel work never edits the same file.

import { common } from './common';
import { commands } from './commands';
import { titleBar } from './titleBar';
import { frame } from './frame';
import { layout } from './layout';
import { tree } from './tree';
import { page } from './page';
import { palette } from './palette';
import { shortcuts } from './shortcuts';
import { settings } from './settings';
import { setup } from './setup';
import { theme } from './theme';
import { updates } from './updates';
import { errors } from './errors';
import { diagnostics } from './diagnostics';
import { keys } from './keys';
import { pageSync } from './pageSync';
import { editor } from './editor';
import { images } from './images';
import { paste } from './paste';
import { tables } from './tables';
import { code } from './code';
import { spelling } from './spelling';
import { readAloud } from './readAloud';
import { history } from './history';
import { ink } from './ink';
import { pageViews } from './pageViews';
import { pagesPlus } from './pagesPlus';
import { smart } from './smart';
import { search } from './search';
import { audio } from './audio';
import { interop } from './interop';
import { intel } from './intel';
import { pageExtras } from './pageExtras';
import { study } from './study';
import { qolSearch } from './qolSearch';

export const en = {
  common,
  commands,
  titleBar,
  frame,
  layout,
  tree,
  page,
  palette,
  shortcuts,
  settings,
  setup,
  theme,
  updates,
  errors,
  diagnostics,
  keys,
  pageSync,
  editor,
  images,
  paste,
  tables,
  code,
  spelling,
  readAloud,
  history,
  ink,
  pageViews,
  pagesPlus,
  smart,
  search,
  audio,
  interop,
  intel,
  pageExtras,
  study,
  qolSearch,
} as const;
