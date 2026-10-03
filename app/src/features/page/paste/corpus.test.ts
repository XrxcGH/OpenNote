// @vitest-environment jsdom
// The clipboard corpus (PLAN.md section 9.5): each case in tests/fixtures/clipboard/<source>/<case> holds what the
// clipboard gave (fragment.html, text.txt, and facts.json for what the shell reads), and expected.md, the pieces
// the pipeline makes from it as Markdown. The same cases load onto the real clipboard through clipset in E2E.
// Run with UPDATE_CORPUS=1 to write a missing or changed expected.md, then review the diff.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMarkdownCache, serializeTextBlock } from '../../../editor/markdown';
import type { TableData } from '../../../editor/schema/specs';
import type { ClipboardFacts } from '../../../platform/types';
import { splitImages } from './pipeline';
import { sanitizePaste } from './sanitize';

// Vitest runs from the repository or from app/.
const ROOT = [resolve('tests/fixtures/clipboard'), resolve('../tests/fixtures/clipboard')].find((dir) =>
  existsSync(dir),
)!;
const update = !!process.env.UPDATE_CORPUS;

function tableMarkdown(table: TableData): string {
  // A backslash is escaped with the pipe, or one before a pipe would read as that pipe's escape.
  const cell = (text: string) => text.replace(/[\\|]/g, '\\$&').replace(/\n/g, ' ');
  const lines = table.rows.map(
    (row) => `| ${table.columns.map((column) => cell(row.cells[column.id]?.markdown ?? '')).join(' | ')} |`,
  );
  const rule = `| ${table.columns.map(() => '---').join(' | ')} |`;
  if (table.header) lines.splice(1, 0, rule);
  else lines.unshift(`| ${table.columns.map(() => ' ').join(' | ')} |`, rule);
  return lines.join('\n');
}

function read(dir: string, name: string): string | null {
  const file = join(dir, name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** What a case pastes as, one piece after another, with the source first. */
function pasteCase(dir: string): string {
  const html = read(dir, 'fragment.html');
  const text = read(dir, 'text.txt');
  const factsJson = read(dir, 'facts.json');
  const facts: ClipboardFacts | null = factsJson
    ? { sequence: 1, textSha256: null, sourceUrl: null, hasOneNote: false, wordImages: [], ...JSON.parse(factsJson) }
    : null;
  const result = sanitizePaste({ html, text, facts }, { newId: counter() });
  const cache = createMarkdownCache();
  const pieces = splitImages(result.pieces).map((piece) => {
    if (piece.kind === 'text') return serializeTextBlock(piece.doc, cache);
    if (piece.kind === 'table') return tableMarkdown(piece.data);
    return `![${piece.request.alt}](${piece.request.src}) <!-- image block -->`;
  });
  return `<!-- source: ${result.source} -->\n\n${pieces.join('\n\n<!-- next block -->\n\n')}\n`;
}

function counter(): () => string {
  let next = 0;
  return () => `id${(next += 1)}`;
}

const cases = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((source) =>
    readdirSync(join(ROOT, source.name), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${source.name}/${entry.name}`),
  )
  // Image-only cases (image.png) are for the real clipboard.
  .filter((name) => ['fragment.html', 'text.txt'].some((file) => existsSync(join(ROOT, name, file))));

describe('the clipboard corpus', () => {
  it('has a case for each source the pipeline knows', () => {
    const sources = new Set(cases.map((name) => name.split('/')[0]));
    for (const source of ['word', 'onenote', 'gdocs', 'excel', 'vscode', 'web', 'plain', 'markdown']) {
      expect(sources).toContain(source);
    }
  });

  it.each(cases)('%s pastes as its expected Markdown', (name) => {
    const dir = join(ROOT, name);
    const actual = pasteCase(dir);
    const expectedFile = join(dir, 'expected.md');
    if (update || !existsSync(expectedFile)) writeFileSync(expectedFile, actual);
    expect(actual).toBe(readFileSync(expectedFile, 'utf8'));
  });

  it('maps colors from documents and drops them from the web', () => {
    expect(pasteCase(join(ROOT, 'word/basic'))).toContain('<span data-color');
    expect(pasteCase(join(ROOT, 'web/wikipedia-table'))).not.toMatch(/data-color|==/);
  });

  it('keeps unsafe and unknown links inert and never asks for local files', () => {
    const pasted = pasteCase(join(ROOT, 'web/security'));
    expect(pasted).not.toMatch(/javascript|vbscript|alert|steal|owned|win\.ini|file:|cid:|onclick/i);
    expect(pasted).toContain('[an app link](obsidian://open?vault=notes)');
    expect(pasted).toContain('![A remote picture](https://example.com/remote.png) <!-- image block -->');
  });
});
