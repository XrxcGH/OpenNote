import { describe, expect, it } from 'vitest';
import { BUILTIN_IDS, builtinBlocks, builtinInfos, isBuiltin } from './builtinTemplates';
import { parseProblem } from './practice';

/** The template's text with the placeholders a new page fills in. */
const textOf = (id: string): string => {
  const blocks = builtinBlocks(id);
  expect(blocks).not.toBeNull();
  return String(blocks![0].data.markdown)
    .replace('{{title}}', 'Statics set 4')
    .replace('{{date}}', 'Oct 22, 2026')
    .replace('{{cursor}}', '');
};

describe('built-in templates', () => {
  it('lists the three templates for the new-page chooser', () => {
    const infos = builtinInfos();
    expect(infos.map((i) => i.title)).toEqual(['Problem set', 'Cornell notes', 'Lab report']);
    expect(infos.every((i) => isBuiltin(i.id))).toBe(true);
    expect(BUILTIN_IDS).toHaveLength(3);
    expect(builtinBlocks('builtin:nope')).toBeNull();
    expect(builtinBlocks('some-page-id')).toBeNull();
  });

  it('writes a problem set with Given, Find, Solution, and Answer for each problem', () => {
    const text = textOf('builtin:problem-set');
    expect(text.startsWith('# Statics set 4')).toBe(true);
    for (const heading of ['Given', 'Find', 'Solution', 'Answer']) {
      expect(text.match(new RegExp(`^### ${heading}$`, 'gm'))).toHaveLength(2);
    }
    expect(text).toContain('## Problem 2');
    expect(text).not.toContain('{{');
  });

  it('keeps the solution a numbered list that practice mode can read', () => {
    const filled = textOf('builtin:problem-set').replace('1. ', '1. Sum the forces.\n2. Solve for R.');
    expect(parseProblem(filled)?.steps).toEqual(['Sum the forces.', 'Solve for R.']);
  });

  it('writes Cornell notes with cues, notes, and a summary', () => {
    const text = textOf('builtin:cornell');
    expect(text).toContain('Date: Oct 22, 2026');
    expect(text.indexOf('## Cues and questions')).toBeLessThan(text.indexOf('## Notes'));
    expect(text.indexOf('## Notes')).toBeLessThan(text.indexOf('## Summary'));
  });

  it('writes a lab report with its sections in order', () => {
    const text = textOf('builtin:lab-report');
    const order = ['Purpose', 'Hypothesis', 'Materials', 'Procedure', 'Data', 'Analysis', 'Uncertainty', 'Conclusion', 'References'];
    const at = order.map((name) => text.indexOf(`## ${name}`));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});
