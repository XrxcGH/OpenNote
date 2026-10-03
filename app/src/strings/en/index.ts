// Joins the English namespaces. Each namespace file has one owner, so parallel work never edits the same file.

import { common } from './common';
import { commands } from './commands';
import { titleBar } from './titleBar';
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

export const en = {
  common,
  commands,
  titleBar,
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
} as const;
