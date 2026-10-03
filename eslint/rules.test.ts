// Proves each boundary rule in eslint.config.js with a fixture that must fail, plus fixtures that must pass.
// Each fixture says which path to lint it as and which rules must report, so it runs through the real config.
// Run with: npm run test:lint-rules

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(import.meta.dirname, 'fixtures');
const eslint = new ESLint({ cwd: ROOT });

for (const name of readdirSync(FIXTURES).filter((file) => file.endsWith('.fixture'))) {
  test(name, async () => {
    const text = readFileSync(join(FIXTURES, name), 'utf8');
    const lintAs = /lint-as: (\S+)/.exec(text)?.[1];
    const expect = /expect: (.+)/.exec(text)?.[1]?.trim();
    assert.ok(lintAs && expect, `${name} needs lint-as and expect lines`);
    const [result] = await eslint.lintText(text, { filePath: join(ROOT, lintAs) });
    const rules = [...new Set(result.messages.map((message) => message.ruleId ?? message.message))].sort();
    assert.deepEqual(
      rules,
      expect === 'none'
        ? []
        : expect
            .split(',')
            .map((rule) => rule.trim())
            .sort(),
    );
  });
}
