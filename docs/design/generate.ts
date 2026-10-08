// Regenerates every wireframe in docs/design/images, and brand/social-preview.svg, from brand/tokens.json.
// Run with: npm run design

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { socialPreview } from './social-preview.ts';
import { allScreens } from './screens/all.ts';

const OUT_DIR = join(import.meta.dirname, 'images');

mkdirSync(OUT_DIR, { recursive: true });
for (const screen of allScreens()) {
  writeFileSync(join(OUT_DIR, screen.file), screen.svg);
  console.log(`wrote ${screen.file}`);
}

writeFileSync(join(import.meta.dirname, '..', '..', 'brand', 'social-preview.svg'), socialPreview());
console.log('wrote brand/social-preview.svg');
