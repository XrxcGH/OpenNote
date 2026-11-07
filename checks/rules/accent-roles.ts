// Accent roles in the shell (docs/BRAND.md section 4). Each color family has one job there, so a later change that
// makes the shell louder fails here instead of slowly changing the look:
//   1. Candle, dusk and night (the non-subtle accents) belong to the theme toggle, and are never a background.
//   2. The ambient tones are the sky outside the window, and they belong to the canvas.
//   3. The pen colors and the notebook accent belong to the few files that mark a notebook.
//   4. Nothing in the shell loops an animation.
// The rules read only the shell's own files. Content features (tools, engineering, math, page blocks, tables, PDF, ink)
// use these colors as data. The allowlists are in checks.config.json, and a file that needs a line adds it in its own
// change, which is the review.

import type { Finding, Rule } from '../types.ts';
import { stringList } from '../config.ts';
import { matchesAny } from '../glob.ts';
import { reporter } from './helpers.ts';

const DEFAULT_SCOPE = [
  'app/src/shell/**',
  'app/src/ui/**',
  'app/src/features/{tree,settings,setup,theme}/**',
  'app/src/features/qol/TabStrip.*',
  'app/src/features/page/title/**',
  'app/src/features/page/PageView.module.css',
  'app/src/theme/appearance.css',
];
const DEFAULT_OUT_OF_SCOPE = ['app/src/ui/illustrations/**', 'app/src/ui/color/**'];

const COMMENT_LINE = /^\s*\/\//;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;
const CANDLE = /--color-accent-(?:candle|dusk|night)(?![-\w])/;
const CANDLE_BACKGROUND = /background(?:-color)?\s*:[^;{}]*--color-accent-(?:candle|dusk|night)(?![-\w])/;
const AMBIENT = /--color-ambient-/;
const PEN = /--ink-|--notebook-accent/;
const INFINITE = /animation[^;]*\binfinite\b|animation-iteration-count\s*:\s*infinite/;

export const accentRoles: Rule = {
  id: 'accent-roles',
  description: 'Candle, dusk, night, ambient and pen colors appear only in the shell files that own them.',
  appliesTo: (file) => ['css', 'ts', 'tsx'].includes(file.ext),
  check(file, ctx) {
    const scope = stringList(ctx.settings, 'scope');
    const outside = stringList(ctx.settings, 'outOfScope');
    if (TEST_FILE.test(file.path)) return [];
    if (!matchesAny(file.path, scope.length ? scope : DEFAULT_SCOPE)) return [];
    if (matchesAny(file.path, outside.length ? outside : DEFAULT_OUT_OF_SCOPE)) return [];
    const report = reporter('accent-roles', file);
    const allowed = (key: string) => matchesAny(file.path, stringList(ctx.settings, key));
    const findings: Finding[] = [];
    // Block comments are blanked (newlines kept, so line numbers hold), and a background declaration is matched
    // across line breaks, so a comment before it or a value split over two lines does not hide it.
    const text = file.lines.join('\n').replace(BLOCK_COMMENT, (c) => c.replace(/[^\n]/g, ' '));
    const lines = text.split('\n');
    const backgroundLines = new Set<number>();
    for (const m of text.matchAll(new RegExp(CANDLE_BACKGROUND.source, 'g'))) {
      const at = m.index + m[0].search(/--color/);
      backgroundLines.add(text.slice(0, at).split('\n').length);
    }
    lines.forEach((raw, i) => {
      if (COMMENT_LINE.test(raw)) return;
      const line = i + 1;
      if (backgroundLines.has(line))
        findings.push(
          report(line, 'Candle, dusk and night are never a background in the shell. They mark the time of day.'),
        );
      else if (CANDLE.test(raw) && !allowed('candle'))
        findings.push(
          report(
            line,
            'Candle, dusk and night belong to the theme toggle. Add this file to the "candle" list only after review.',
          ),
        );
      if (AMBIENT.test(raw) && !allowed('ambient'))
        findings.push(
          report(
            line,
            'The ambient tones are the sky outside the window, and they belong to the canvas. ' +
              'Add this file to the "ambient" list only after review.',
          ),
        );
      if (PEN.test(raw) && !allowed('pens'))
        findings.push(
          report(
            line,
            'Pen colors mark a notebook in a few places. Add this file to the "pens" list only after review.',
          ),
        );
      if (INFINITE.test(raw)) findings.push(report(line, 'The shell has no animation that loops forever.'));
    });
    return findings;
  },
};
