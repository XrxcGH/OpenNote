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

  it('writes the hide-selection class only when it changes', () => {
    const hide = PATCHES.find((patch) => patch.file.startsWith('node_modules/prosemirror-view/'))!;
    // A class list as the DOM has it: add and remove always write the attribute; toggle with a state writes it
    // only when the state changes.
    const draw = (source: string, visible: boolean, has: boolean) => {
      const writes: string[] = [];
      const classList = {
        add: () => void writes.push('add'),
        remove: () => void writes.push('remove'),
        toggle: (_name: string, on: boolean) => void (on !== has && writes.push(on ? 'add' : 'remove')),
      };
      const hidden: string[] = [];
      new Function('view', 'sel', 'hide', source)({ dom: { classList } }, { visible }, () => hidden.push('guard'));
      return [...writes, ...hidden];
    };
    const shipped =
      'if (sel.visible) {\n  view.dom.classList.remove("ProseMirror-hideselection");\n}\nelse {\n' +
      '  view.dom.classList.add("ProseMirror-hideselection");\n  hide();\n}';
    const fixed = patched(shipped, hide);
    expect(draw(shipped, true, false)).toEqual(['remove']);
    expect(draw(fixed, true, false)).toEqual([]);
    expect(draw(fixed, true, true)).toEqual(['remove']);
    // A hidden selection still sets its guard, as the shipped code does after adding the class.
    expect(draw(fixed, false, true)).toEqual(['guard']);
    expect(draw(fixed, false, false)).toEqual(['add', 'guard']);
    expect(patched(fixed, hide)).toBe(fixed);
  });

  it('has patched the installed files', () => {
    for (const patch of PATCHES) {
      const text = readFileSync(join(ROOT, patch.file), 'utf8');
      expect(patched(text, patch), patch.file).toBe(text);
    }
  });
});
