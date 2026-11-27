// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATCHES, patched } from './patch-dependencies.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const FITTER = PATCHES[0];

describe('patched', () => {
  const shipped =
    'let a;\n    if (index == node.childCount && !type.compatibleContent(node.type))\n        return null;\n';

  it('makes the patch once', () => {
    const once = patched(shipped, FITTER);
    expect(once).toContain('if (!type.compatibleContent(node.type))');
    expect(once).not.toContain('index == node.childCount');
    expect(patched(once, FITTER)).toBe(once);
  });

  it('fails when the text to patch is gone, so a new version gets a look', () => {
    expect(() => patched('let a;\n', FITTER)).toThrow(/appears 0 times/);
  });

  it('fails when the text to patch appears twice', () => {
    expect(() => patched(shipped + shipped, FITTER)).toThrow(/appears 2 times/);
  });

  it('has patched the installed files', () => {
    for (const patch of PATCHES) {
      const text = readFileSync(join(ROOT, patch.file), 'utf8');
      expect(patched(text, patch), patch.file).toBe(text);
    }
  });
});
