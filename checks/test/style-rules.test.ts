// Tests for the rules that guard the interface's style: the token rule's forced colors and ink pairs, logical
// properties, and the interface voice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messages, run } from './helpers.ts';
import { brandTokens, contrastRatio, resolveColor } from '../rules/brand-tokens.ts';
import type { Tokens } from '../rules/brand-tokens.ts';
import { logicalProperties } from '../rules/logical-properties.ts';
import { uiVoice, variants } from '../rules/ui-voice.ts';

const baseTokens = (): Tokens => ({
  color: {
    light: { text: { primary: '#2B2521' }, surface: { page: '#FFFCF6', selected: '#DDE8DA' } },
    dark: { text: { primary: '#F0E9DE' }, surface: { page: '#24201C', selected: '#2E3B30' } },
  },
  ink: {
    pens: [{ name: 'Amber', light: '#B8620F', dark: '#F0AE68' }],
    highlighters: [{ name: 'Honey', light: '#F2CF4A66', dark: '#A88A2C66' }],
  },
});

const tokenMessages = async (tokens: Tokens) =>
  (await run({ rule: brandTokens, path: 'brand/tokens.json', text: JSON.stringify(tokens, null, 2) })).map(
    (f) => f.message,
  );

test('brand-tokens accepts system color keywords that name existing tokens', async () => {
  const tokens = { ...baseTokens(), forcedColors: { 'surface.selected': 'Highlight', 'text.primary': 'CanvasText' } };
  assert.deepEqual(await tokenMessages(tokens), []);
});

test('brand-tokens rejects forced colors that are hex values or name no token', async () => {
  const tokens = { ...baseTokens(), forcedColors: { 'surface.selected': '#FF0000', 'surface.missing': 'Canvas' } };
  const found = (await tokenMessages(tokens)).join('\n');
  assert.match(found, /"surface.selected" must be a CSS system color/);
  assert.match(found, /names "surface.missing", which isn't a color token/);
});

test('brand-tokens resolves pens per theme in contrast pairs', async () => {
  const tokens = baseTokens();
  assert.equal(resolveColor(tokens, 'light', 'ink.pens.Amber'), '#B8620F');
  assert.equal(resolveColor(tokens, 'dark', 'ink.pens.Amber'), '#F0AE68');
  assert.equal(resolveColor(tokens, 'dark', 'ink.pens.Missing'), undefined);
  const passing = { ...tokens, contrast: [{ fg: 'ink.pens.Amber', bg: 'surface.selected', min: 3 }] };
  assert.deepEqual(await tokenMessages(passing), []);
  const failing = { ...tokens, contrast: [{ fg: 'ink.pens.Amber', bg: 'surface.selected', min: 4 }] };
  assert.match((await tokenMessages(failing)).join('\n'), /light: ink.pens.Amber on surface.selected has contrast 3.4/);
  const missing = { ...tokens, contrast: [{ fg: 'ink.pens.Coral', bg: 'surface.page', min: 3 }] };
  assert.match((await tokenMessages(missing)).join('\n'), /ink.pens.Coral on surface.page doesn't exist/);
});

test('brand-tokens composites a highlighter over the page before measuring text on it', async () => {
  const pair = { fg: 'text.primary', bg: 'ink.highlighters.Honey', over: 'surface.page', min: 7 };
  assert.deepEqual(await tokenMessages({ ...baseTokens(), contrast: [pair] }), []);
  // The old dark Honey, #C9A42F66, doesn't reach 7:1 under the dark theme's text.
  const old = baseTokens();
  old.ink!.highlighters![0].dark = '#C9A42F66';
  assert.match((await tokenMessages({ ...old, contrast: [pair] })).join('\n'), /dark: text.primary on ink.hig/);
  assert.ok(contrastRatio('#F0E9DE', '#A88A2C66', '#24201C') >= 7);
});

test('brand-tokens enforces a ceiling on contrast, for washes that must stay close to a surface', async () => {
  const tokens = baseTokens();
  // The selected row and the page are 1.2:1 apart in light and 1.4:1 in dark.
  const ceiling = (max: number) => ({ ...tokens, contrast: [{ fg: 'surface.selected', bg: 'surface.page', max }] });
  assert.deepEqual(await tokenMessages(ceiling(1.5)), []);
  const found = await tokenMessages(ceiling(1.05));
  assert.equal(found.length, 2);
  assert.match(
    found[0],
    /^light: surface.selected on surface.page has contrast 1.\d\d:1, which is over the 1.05:1 ceiling/,
  );
  assert.match(
    found[1],
    /^dark: surface.selected on surface.page has contrast 1.\d\d:1, which is over the 1.05:1 ceiling/,
  );
});

test('brand-tokens checks a floor and a ceiling together, and asks for at least one', async () => {
  const tokens = baseTokens();
  const both = { fg: 'text.primary', bg: 'surface.page', min: 7, max: 12 };
  const found = await tokenMessages({ ...tokens, contrast: [both] });
  assert.equal(found.length, 2);
  assert.match(
    found[0],
    /^light: text.primary on surface.page has contrast 1\d.\d\d:1, which is over the 12:1 ceiling/,
  );
  const neither = await tokenMessages({ ...tokens, contrast: [{ fg: 'text.primary', bg: 'surface.page' }] });
  assert.match(neither[0], /text.primary on surface.page needs a "min", a "max", or both/);
});

test('logical-properties flags physical properties and values in style sheets', async () => {
  const css = [
    '.a { margin-left: 4px; inset-inline-start: 0; }',
    '  top: 0;',
    '  border-right-color: var(--color-border-subtle);',
    '  text-align: left;',
    '  --size-left: 4px;',
    '@media (min-width: 600px) {',
    '.a:hover { block-size: 2px; }',
  ].join('\n');
  const found = messages(await run({ rule: logicalProperties, path: 'app/src/ui/A.module.css', text: css }));
  const suffix = ', which follows the writing direction.';
  assert.deepEqual(found, [
    `1:warning:Physical property "margin-left". Use "margin-inline-start"${suffix}`,
    `2:warning:Physical property "top". Use "inset-block-start"${suffix}`,
    `3:warning:Physical property "border-right-color". Use "border-inline-end-color"${suffix}`,
    '4:warning:"text-align: left" is physical. Use "text-align: start".',
  ]);
});

test('logical-properties reads inline styles in components and skips other code', async () => {
  const tsx = '<div style={{ marginRight: 4, insetInlineStart: 0 }} />\nconst box = { left: 1 };\n';
  const found = messages(await run({ rule: logicalProperties, path: 'app/src/ui/A.tsx', text: tsx }));
  assert.equal(found.length, 1);
  assert.match(found[0], /"margin-right"/);
  assert.deepEqual(await run({ rule: logicalProperties, path: 'checks/a.css', text: '.a { left: 0; }' }), []);
});

test('ui-voice reads each branch of an ICU message', () => {
  assert.deepEqual(variants('{count, plural, one {Moved # page to {target}.} other {Moved # pages.}}'), [
    'Moved 3 page to Biology.',
    'Moved 3 pages.',
  ]);
  assert.deepEqual(variants('{theme, select, dark {Dark theme} other {Light theme}}, following Windows'), [
    'Dark theme, following Windows',
    'Light theme, following Windows',
  ]);
  assert.deepEqual(variants('Step {index} of {count}'), ['Step Biology of Biology']);
});

test('ui-voice flags exclamation marks, Oops, emoji, Title Case, number words, and shortcut forms', async () => {
  const text = [
    'export const demo = {',
    "  saved: 'Saved!',",
    "  failed: 'Oops, that failed.',",
    "  done: 'All done 🎉',",
    "  title: 'Open The Notebook Settings Page',",
    "  count: 'Moved three pages.',",
    "  keys: 'Press Control+D or Ctrl-D.',",
    "  good: 'Press Ctrl+Shift+D to switch.',",
    '} as const;',
  ].join('\n');
  const found = await run({ rule: uiVoice, path: 'app/src/strings/en/demo.ts', text });
  assert.deepEqual(
    found.map((f) => `${f.line}:${f.severity}`),
    ['2:error', '3:error', '4:error', '5:error', '6:warning', '7:error'],
  );
});

test('ui-voice runs the spelling and AI marker rules on string values', async () => {
  const text = "export const demo = {\n  a: 'Change the colour.',\n  b: 'Delve into your notes.',\n};\n";
  const found = messages(await run({ rule: uiVoice, path: 'app/src/strings/en/demo.ts', text }));
  assert.ok(found.some((m) => m.startsWith('2:error:"colour" is not American spelling')));
  assert.ok(found.some((m) => m.startsWith('3:error:"delve" reads as AI-generated')));
  assert.deepEqual(await run({ rule: uiVoice, path: 'app/src/theme/theme.ts', text }), []);
});
