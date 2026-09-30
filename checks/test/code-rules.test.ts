// Tests for the rules that read code and data: hygiene, modifiability, brand consistency, and tokens,
// plus the comment scanner and glob matching they rely on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messages, run } from './helpers.ts';
import { hygiene } from '../rules/hygiene.ts';
import { modifiability } from '../rules/modifiability.ts';
import { brandConsistency } from '../rules/brand-consistency.ts';
import { brandTokens, contrastRatio } from '../rules/brand-tokens.ts';
import { usability } from '../rules/usability.ts';
import { findBrowser, layout } from '../rules/layout.ts';
import { letterCase } from '../text.ts';
import { splitCode } from '../comments.ts';
import { globToRegExp } from '../glob.ts';

test('hygiene flags whitespace, CRLF, missing newline and invisible characters', async () => {
  const text = 'ok \nwindows\r\nzero\u200Bwidth\nlast';
  const found = await run({ rule: hygiene, path: 'a.txt', text });
  assert.equal(found.length, 4);
  assert.ok(found.every((f) => f.fix));
});

test('hygiene flags secrets without flagging itself', async () => {
  const fakeKey = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const found = await run({ rule: hygiene, path: 'a.ts', text: `const key = '${fakeKey}';\n` });
  assert.match(found[0].message, /secret/);
});

test('hygiene flags a Tauri updater private key', async () => {
  const headers = ['rsign', 'minisign'].map((tool) => `untrusted comment: ${tool} ` + 'encrypted secret key');
  for (const text of headers.flatMap((h) => [h, Buffer.from(h).toString('base64')])) {
    const found = await run({ rule: hygiene, path: 'a.env', text: `KEY=${text}\n` });
    assert.match(found[0].message, /secret/);
  }
  const publicKey = Buffer.from('untrusted comment: minisign public key').toString('base64');
  assert.equal((await run({ rule: hygiene, path: 'a.json', text: `"${publicKey}"\n` })).length, 0);
});

test('comment scanner separates comments, strings and regex literals', () => {
  const lines = [
    "const url = 'http://x'; // real comment",
    'const re = /[/*]+/g; /* block */',
    "let s = '// not a comment';",
  ];
  const { comments, code } = splitCode(lines, 'ts');
  assert.deepEqual(
    comments.map((c) => c.text),
    ['real comment', 'block'],
  );
  assert.ok(!code[2].includes('not a comment'));
});

test('comment scanner handles Rust lifetimes and Python', () => {
  const rust = splitCode(["fn f<'a>(x: &'a str) {} // note"], 'rs');
  assert.equal(rust.comments[0].text, 'note');
  const python = splitCode(["x = '#' # note"], 'py');
  assert.equal(python.comments[0].text, 'note');
});

test('modifiability measures function length, nesting and parameters', async () => {
  const body = Array.from({ length: 60 }, (_, i) => `  total += ${i};`).join('\n');
  const text = `function big(a, b, c, d, e, f) {\n  let total = 0;\n${body}\n  return total;\n}\n`;
  const found = await run({ rule: modifiability, path: 'a.ts', text });
  assert.ok(found.some((f) => f.message.includes('"big" is 64 lines')));
  assert.ok(found.some((f) => f.message.includes('takes 6 parameters')));
});

test('modifiability flags deep nesting and untracked TODOs', async () => {
  const nested = 'function f() {\n if (a) {\n if (b) {\n if (c) {\n if (d) {\n if (e) {\n }\n }\n }\n }\n }\n}\n';
  const found = await run({ rule: modifiability, path: 'a.ts', text: `${nested}// TODO fix\n// TODO(#12) fine\n` });
  assert.ok(found.some((f) => f.message.includes('nests 5 levels')));
  assert.equal(found.filter((f) => f.message.startsWith('TODO')).length, 1);
});

test('modifiability flags commented-out code', async () => {
  const text = 'const a = 1;\n// const b = 2;\n// if (a) {\n//   run();\n// }\n';
  const found = await run({ rule: modifiability, path: 'a.ts', text });
  assert.ok(found.some((f) => f.message.startsWith('Commented-out code')));
});

test('brand-consistency requires tokens in UI code', async () => {
  const text = "const s = { color: '#ff0000', fontFamily: 'Arial', transition: 'opacity 600ms' };\n";
  const found = await run({ rule: brandConsistency, path: 'app/src/ui/Button.tsx', text });
  assert.equal(found.filter((f) => f.severity === 'error').length, 3);
  const tokens = await run({ rule: brandConsistency, path: 'app/src/theme/tokens.ts', text });
  assert.equal(tokens.length, 0);
  const handWritten = await run({ rule: brandConsistency, path: 'app/src/theme/theme.ts', text });
  assert.equal(handWritten.filter((f) => f.severity === 'error').length, 3);
});

const RAW_COLOR = '1:error:Raw color value. Use a color token from brand/tokens.json.';
const brandMessages = async (path: string, text: string) => messages(await run({ rule: brandConsistency, path, text }));

test('brand-consistency flags raw colors and ignores named colors outside color values', async () => {
  const flagged = [
    ['a.css', '.desk { background: white; }'],
    ['a.css', '.a { border: 1px solid Black !important; }'],
    ['a.css', '.a { border-color: color-mix(in srgb, red 20%, transparent); }'],
    ['a.css', '.a { background-color: hwb(0 100% 0%); }'],
    ['a.css', '.a { color: color(display-p3 1 0 0); }'],
    ['a.css', '.a { outline-color: RGB(0 0 0); }'],
    ['a.tsx', "const s = { backgroundColor: 'white' };"],
    ['a.tsx', "const s = { color: dark ? 'white' : 'black' };"],
    ['a.tsx', '<path fill="white" d="M0 0h1" />'],
    ['a.tsx', "ctx.fillStyle = 'white';"],
    ['a.tsx', "element.style.backgroundColor = 'black';"],
  ];
  for (const [name, text] of flagged) assert.deepEqual(await brandMessages(`app/src/${name}`, text), [RAW_COLOR], text);
  const allowed = [
    ['a.css', '.a { color: currentColor; background: transparent; border-color: inherit; }'],
    ['a.css', '.a { border-color: color-mix(in srgb, var(--color-accent) 20%, transparent); }'],
    ['a.css', '.a { background: var(--color-white); outline: none; }'],
    ['a.css', '@media (prefers-color-scheme: dark) {'],
    ['a.tsx', "const pen = { id: 'red', color: tokens.ink.red, tone: 'blue' };"],
    ['a.tsx', "const stroke = { color: 'Indigo', width: 2 };"],
    ['a.tsx', '<path fill="currentColor" aria-label="red" />'],
    ['a.tsx', '<button data-color="red" onClick={pick} />'],
    ['a.tsx', "if (element.dataset.color === 'red') ctx.fillStyle = tokens.ink.red;"],
  ];
  for (const [name, text] of allowed) assert.deepEqual(await brandMessages(`app/src/${name}`, text), [], text);
});

test('brand-consistency flags raw fonts and layers', async () => {
  const css = [
    '.a { font: 14px Arial, sans-serif; }',
    '.a { font: 600 var(--type-body-size) var(--font-ui); }',
    '.a { font: inherit; }',
    '.a { font: italic var(--type-body-size) / var(--type-body-line) var(--font-ui, var(--font-fallback)); }',
    '.a { z-index: 9999; }',
    '.a { z-index: auto; }',
    '.a { z-index: var(--layer-dialog); }',
  ];
  assert.deepEqual(await brandMessages('app/src/a.css', css.join('\n')), [
    '1:error:Raw font shorthand. Use font and type tokens.',
    '2:error:Raw font shorthand. Use font and type tokens.',
    '5:error:Raw z-index. Use a layer token.',
  ]);
  const tsx = [
    "const s = { font: '14px Arial', zIndex: 9999 };",
    "ctx.font = '14px Arial';",
    'const s = { font: `${size}px Arial` };',
    "const s = { fontFamily: 'Arial' };",
    "const s = { font: 'inherit' };",
    "function label(font: 'ui' | 'mono' = 'ui') {}",
    "text({ size: 15, font: 'reading' });",
    'ctx.font = `${size}px/${line}px ${fonts.ui}`;',
    'const s = { fontFamily: tokens.font.ui, zIndex: tokens.layer.dialog };',
    "const s = { fontFamily: 'var(--font-ui)' };",
  ];
  assert.deepEqual(await brandMessages('app/src/a.tsx', tsx.join('\n')), [
    '1:error:Raw font shorthand. Use font and type tokens.',
    '1:error:Raw z-index. Use a layer token.',
    '2:error:Raw font shorthand. Use font and type tokens.',
    '3:error:Raw font shorthand. Use font and type tokens.',
    '4:error:Raw font family. Use a font token.',
  ]);
});

test('contrast ratio matches WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.equal(contrastRatio('#777777', '#FFFFFF').toFixed(2), '4.48');
});

test('brand-tokens checks theme parity, contrast and motion', async () => {
  const tokens = {
    color: {
      light: { text: { primary: '#222222' }, surface: { page: '#FFFFFF' } },
      dark: { text: { primary: '#333333' } },
    },
    contrast: [{ fg: 'text.primary', bg: 'surface.page', min: 4.5 }],
    motion: { duration: { slow: 900 } },
  };
  const found = await run({ rule: brandTokens, path: 'brand/tokens.json', text: JSON.stringify(tokens, null, 2) });
  const text = found.map((f) => f.message).join('\n');
  assert.match(text, /missing color "surface.page"/);
  assert.match(text, /900ms/);
});

test('usability checks UI accessibility basics', async () => {
  const text = '<img src="a.png">\n<div onClick={go}>Go</div>\n';
  const found = await run({ rule: usability, path: 'app/src/ui/A.tsx', text });
  assert.equal(found.length, 2);
});

test('glob patterns match paths', () => {
  assert.ok(globToRegExp('app/src/**/*.{ts,tsx}').test('app/src/ui/a/B.tsx'));
  assert.ok(globToRegExp('**/*.lock').test('Cargo.lock'));
  assert.ok(!globToRegExp('brand/*').test('brand/a/b.json'));
});

test('letter case tells sentence case, Title Case, and UPPER CASE apart', () => {
  assert.equal(letterCase('Page layout and print'), 'sentence');
  assert.equal(letterCase('Page Layout And Print Settings'), 'title');
  assert.equal(letterCase('PAGE LAYOUT'), 'upper');
  assert.equal(letterCase('NOTEBOOKS'), 'sentence');
  assert.equal(letterCase('Biology 101 › Lectures › Cell Structure Notes'), 'sentence');
});

test('layout finds overlap, off-center text, and edge crowding', { skip: !findBrowser() }, async () => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200">',
    '<text x="20" y="40" font-size="16">Overlapping one</text>',
    '<text x="30" y="44" font-size="16">Overlapping two</text>',
    '<g data-center="both"><rect x="200" y="100" width="150" height="40"/>',
    '<text x="210" y="125" font-size="14">Go</text></g>',
    '<text x="1" y="190" font-size="9">Tiny text</text>',
    '</svg>',
  ].join('');
  const messages = (await run({ rule: layout, path: 'a.svg', text: svg })).map((f) => f.message).join('\n');
  assert.match(messages, /overlaps/);
  assert.match(messages, /off horizontal center/);
  assert.match(messages, /minimum is 11px/);
  assert.match(messages, /closer than 4px to the edge/);
});
