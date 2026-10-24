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
import { language } from './language';
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
import { mathTools } from './mathTools';
import { search } from './search';
import { audio } from './audio';
import { audioMore } from './audioMore';
import { interop } from './interop';
import { moreInterop } from './moreInterop';
import { intel } from './intel';
import { pageExtras } from './pageExtras';
import { video } from './video';
import { study } from './study';
import { science } from './science';
import { qolSearch } from './qolSearch';
import { intelPlus } from './intelPlus';
import { qol } from './qol';
import { storage } from './storage';
import { accounts } from './accounts';
import { connectors } from './connectors';
import { platformApi } from './platformApi';
import { pdf } from './pdf';
import { intelSpeech } from './intelSpeech';
import { intelMore } from './intelMore';
import { myHand } from './myHand';
import { tableMath } from './tableMath';
import { solvers } from './solvers';
import { graph3d } from './graph3d';
import { engineering } from './engineering';
import { chem } from './chem';
import { docStructure } from './docStructure';
import { codeCells } from './codeCells';
import { kitElectrical } from './kitElectrical';

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
  language,
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
  mathTools,
  search,
  audio,
  audioMore,
  interop,
  moreInterop,
  intel,
  pageExtras,
  video,
  study,
  qolSearch,
  intelPlus,
  qol,
  storage,
  connectors,
  platformApi,
  pdf,
  intelSpeech,
  intelMore,
  accounts,
  myHand,
  tableMath,
  science,
  solvers,
  graph3d,
  engineering,
  chem,
  docStructure,
  codeCells,
  kitElectrical,
} as const;
