// A page with no code cell must not load the code editor: CodeMirror (137 KB gzip), the checkers, and the run core
// stay lazy chunks of the code studio. Every file of this feature may import the studio's contracts and the editor's
// types, but the studio's editor, completion, diagnostics, and run chunks only through a dynamic import().
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HERE = new URL('./', import.meta.url);
const FILES = readdirSync(HERE).filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'));

/** The module names a file imports with a static `import ... from`, type-only imports left out. */
function staticImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gms)) {
    if (!match[1]) found.push(match[2]!);
  }
  return found;
}

const HEAVY = [/^@codemirror\//, /^@lezer\//, /codestudio\/(editor|complete|diagnostics|run|runtimes|project|window)/];

describe('code cells load lazily', () => {
  it.each(FILES)('%s imports no editor, checker, or run chunk statically', (name) => {
    const source = readFileSync(new URL(name, HERE), 'utf8');
    const heavy = staticImports(source).filter((module) => HEAVY.some((pattern) => pattern.test(module)));
    expect(heavy).toEqual([]);
  });

  it('reaches the editor only through the studio’s loader functions', () => {
    const panel = readFileSync(new URL('CodeCellPanel.tsx', HERE), 'utf8');
    expect(panel).toContain("await import('../codestudio')");
    expect(panel).toContain('loadCodeEditor()');
    expect(panel).toContain('loadDiagnostics');
    expect(panel).toContain('loadCompletion');
  });
});
