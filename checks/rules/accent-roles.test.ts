// Tests for the accent-roles rule: one passing and one failing fixture per rule, and out-of-scope files that pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messages, run } from '../test/helpers.ts';
import { accentRoles } from './accent-roles.ts';

const settings = {
  candle: ['app/src/features/theme/ThemeToggle.module.css'],
  ambient: ['app/src/shell/layout/Workspace.module.css'],
  pens: ['app/src/features/tree/Tree.module.css'],
};

const check = (path: string, text: string) => run({ rule: accentRoles, path, text, settings });

test('candle, dusk and night: the theme toggle may use them, the command bar may not', async () => {
  const line = '.sun { color: var(--color-accent-candle); }\n';
  assert.deepEqual(await check('app/src/features/theme/ThemeToggle.module.css', line), []);
  const found = await check(
    'app/src/shell/commandbar/CommandBar.module.css',
    '.tool { border-color: var(--color-accent-candle); }\n',
  );
  assert.equal(found.length, 1);
  assert.match(messages(found)[0], /theme toggle/);
});

test('candle, dusk and night are never a background, even in the theme toggle', async () => {
  const found = await check(
    'app/src/features/theme/ThemeToggle.module.css',
    '.sun { background: var(--color-accent-night); }\n',
  );
  assert.equal(found.length, 1);
  assert.match(messages(found)[0], /never a background/);
});

test('the subtle accents are not candle, dusk or night', async () => {
  assert.deepEqual(
    await check(
      'app/src/shell/commandbar/CommandBar.module.css',
      '.a { background: var(--color-accent-candle-subtle); }\n',
    ),
    [],
  );
});

test('ambient tones: the canvas may use them, the title bar may not', async () => {
  const line = '.canvas { background: var(--color-ambient-glow); }\n';
  assert.deepEqual(await check('app/src/shell/layout/Workspace.module.css', line), []);
  const found = await check('app/src/shell/titlebar/TitleBar.module.css', line);
  assert.equal(found.length, 1);
  assert.match(messages(found)[0], /sky outside the window/);
});

test('pen colors: the tree may use them, the command bar may not', async () => {
  const line = '.chip { background: var(--ink-fern); }\n';
  assert.deepEqual(await check('app/src/features/tree/Tree.module.css', line), []);
  const found = await check('app/src/shell/commandbar/CommandBar.module.css', line);
  assert.equal(found.length, 1);
  assert.match(messages(found)[0], /notebook/);
  assert.equal(
    (await check('app/src/shell/commandbar/CommandBar.module.css', 'a { color: var(--notebook-accent); }\n')).length,
    1,
  );
});

test('an animation that loops forever fails in the shell', async () => {
  assert.deepEqual(await check('app/src/shell/layout/Rail.module.css', '.a { animation: pulse 1s ease 2; }\n'), []);
  const found = await check('app/src/shell/layout/Rail.module.css', '.a { animation: pulse 1s infinite; }\n');
  assert.equal(found.length, 1);
  assert.match(messages(found)[0], /forever/);
});

test('files outside the shell, tests and comments pass', async () => {
  const pen = '.a { color: var(--ink-fern); }\n';
  assert.deepEqual(await check('app/src/features/tools/ui/tools.module.css', pen), []);
  assert.deepEqual(await check('app/src/ui/color/palette.module.css', pen), []);
  assert.deepEqual(
    await check('app/src/ui/illustrations/illustrations.module.css', '.a { fill: var(--color-ambient-glow); }\n'),
    [],
  );
  assert.deepEqual(await check('app/src/shell/commandbar/CommandBar.test.tsx', pen), []);
  assert.deepEqual(await check('app/src/shell/commandbar/CommandBar.module.css', '/* a pen: var(--ink-fern) */\n'), []);
});
