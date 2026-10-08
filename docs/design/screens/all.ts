// Every wireframe, in the order they are written. The generator writes them, and the geometry tests draw them.

import type { Screen } from './screen.ts';
import { firstRunLook, firstRunSmart, firstRunStorage } from './first-run.ts';
import { studyTools } from './study.ts';
import { sendTo } from './send-to.ts';
import { newPage, organize, search } from './workspace.ts';
import { paginated, recording } from './page-views.ts';
import { settings } from './settings.ts';
import { phone, sizeClasses } from './responsive.ts';
import { crashConsent, feedbackReview, selfCheck } from './hardening.ts';
import { firstRunImport, firstRunKeys, firstRunWelcome } from './setup.ts';
import { drawTab, linkedPages, mathGrapher, pageEditor, searchPanel, tablesCharts, viewTab } from './editing.ts';
import {
  connectorsSettings,
  exportDialog,
  importDialog,
  intelligenceSettings,
  privacySettings,
  recordingOptions,
  toolWindows,
} from './panels.ts';

/** Draws every wireframe. */
export function allScreens(): Screen[] {
  return [
    firstRunLook(),
    firstRunStorage(),
    firstRunSmart(),
    newPage('light'),
    newPage('dark'),
    organize(),
    paginated(),
    recording(),
    search(),
    settings(),
    sizeClasses(),
    phone(),
    studyTools(),
    sendTo(),
    crashConsent(),
    selfCheck(),
    feedbackReview(),
    firstRunWelcome(),
    firstRunKeys(),
    firstRunImport(),
    pageEditor(),
    drawTab(),
    viewTab(),
    tablesCharts(),
    mathGrapher(),
    searchPanel(),
    linkedPages(),
    recordingOptions(),
    importDialog(),
    exportDialog(),
    intelligenceSettings(),
    privacySettings(),
    connectorsSettings(),
    toolWindows(),
  ];
}
