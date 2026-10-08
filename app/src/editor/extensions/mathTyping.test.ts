// @vitest-environment jsdom
// Typing $x^2$ makes an equation and $$x^2$$ on its own line makes display math.
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor, typeInto } from '../commands/testing';
import type { TestEditor } from '../commands/testing';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

const names = (page: TestEditor): string[] => {
  const out: string[] = [];
  page.editor.state.doc.descendants((node) => {
    out.push(node.type.name);
  });
  return out;
};

describe('typing math', () => {
  it('turns $x^2$ into an inline equation', () => {
    mounted = mountEditor('[]');
    typeInto(mounted.editor, 'Inline $x^2$');
    expect(names(mounted)).toContain('mathInline');
  });

  it('leaves prices alone', () => {
    mounted = mountEditor('[]');
    typeInto(mounted.editor, 'It costs $5 and $');
    expect(names(mounted)).not.toContain('mathInline');
  });

  it('turns $$x^2$$ on its own line into display math', () => {
    mounted = mountEditor('[]');
    typeInto(mounted.editor, '$$x^2$$');
    expect(names(mounted)).toContain('mathBlock');
  });
});
