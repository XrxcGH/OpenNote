// Regenerates every wireframe in docs/design/images from brand/tokens.json.
// Run with: npm run design

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Screen } from './screens/screen.ts';
import { firstRunLook, firstRunSmart, firstRunStorage } from './screens/first-run.ts';
import { studyTools } from './screens/study.ts';
import { newPage, organize, search } from './screens/workspace.ts';
import { paginated, recording } from './screens/page-views.ts';
import { settings } from './screens/settings.ts';
import { phone, sizeClasses } from './screens/responsive.ts';

const OUT_DIR = join(import.meta.dirname, 'images');

const screens: Screen[] = [
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
];

mkdirSync(OUT_DIR, { recursive: true });
for (const screen of screens) {
  writeFileSync(join(OUT_DIR, screen.file), screen.svg);
  console.log(`wrote ${screen.file}`);
}
