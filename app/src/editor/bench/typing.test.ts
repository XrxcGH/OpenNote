// @vitest-environment jsdom
// The typing path's microbenchmarks (Phase 4 ARCHITECTURE.md sections 24.1 and 26.4; owner: WP8). They run on the
// 20-page flat note and the 20-page outline:
// - Phase 4's plugins per transaction: a key's transaction applied to the editor's full state, minus the same
//   transaction applied to a state with no plugins. Budget 1.5 ms at the 95th percentile.
// - Serializer throughput: cold, then with a typing session's warm cache.
// - Flush cost: serializing after a key, the splice against the last Markdown, and the request's JSON.
// - The range re-parse that applies undo and redo frames.
//
// Budgets are for the reference laptop. A fixed benchmark scales them on slower machines, as Phase 2's perf tests
// do, so a pull request fails only when the code got slower.
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterAll, describe, expect, it } from 'vitest';
// The page fixtures are test data; the editor library itself never reads them.
// eslint-disable-next-line opennote/editor-boundaries
import { pageFixture } from '../../services/pages/fixtures';
import { createBlockEditor } from '../extensions/kit';
import { testHost } from '../commands/testing';
import {
  createMarkdownCache,
  diffMarkdown,
  parseTextBlock,
  reparseRange,
  serializeTextBlock,
  utf8Offset,
} from '../markdown';

const KEYS = 200;
/** The fixed benchmark's time on the reference laptop, in ms (tests/ui/perf/tree.perf.spec.ts). */
const REFERENCE_BENCHMARK_MS = 60;
const PLUGINS_BUDGET_MS = 1.5;
const FLUSH_BUDGET_MS = 8;
/** Undo's whole feedback budget is 50 ms; the range re-parse gets less than half. */
const UNDO_BUDGET_MS = 50;
const REPARSE_BUDGET_MS = 20;

/** How much slower this machine is than the reference laptop: the best of 5 runs, from 1 to 4. */
function calibration(): number {
  let best = Infinity;
  for (let run = 0; run < 5; run += 1) {
    const start = performance.now();
    let total = 0;
    for (let round = 0; round < 40; round += 1) {
      const items = Array.from({ length: 20_000 }, (_, i) => (i * 7919) % 10_007);
      items.sort((a, b) => a - b);
      total += items[round];
    }
    if (total >= 0) best = Math.min(best, performance.now() - start);
  }
  // A machine more than 4 times slower is too busy to measure; its budgets stop growing, so it fails loudly.
  return Math.min(4, Math.max(1, best / REFERENCE_BENCHMARK_MS));
}

const scale = calibration();

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

const markdownOf = (fixture: 'twentyPage' | 'twentyPageOutline') =>
  (pageFixture(fixture).page.blocks[0].data as { markdown: string }).markdown;

/** A caret in the middle of the document, inside a textblock. */
function middle(doc: PMNode): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isTextblock && pos >= doc.content.size / 2) found = pos + 1 + Math.floor(node.content.size / 2);
    return !node.isTextblock;
  });
  return found;
}

/** Applies KEYS one-letter transactions in the middle and returns each one's time in ms. */
function typeInto(start: EditorState): number[] {
  let state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, middle(start.doc))));
  const times: number[] = [];
  for (let i = 0; i < KEYS; i += 1) {
    const tr = state.tr.insertText('abc '[i % 4]);
    const before = performance.now();
    state = state.apply(tr);
    times.push(performance.now() - before);
  }
  return times;
}

const editors: Editor[] = [];

/** Prints one measure, with the machine's scale, for docs/perf/phase-4.md. */
function record(name: string, value: string): void {
  console.log(`[typing bench] ${name}: ${value} (machine scale ${scale.toFixed(2)})`);
}

afterAll(() => editors.forEach((editor) => editor.destroy()));

describe.each(['twentyPage', 'twentyPageOutline'] as const)('the typing path in %s', (fixture) => {
  const markdown = markdownOf(fixture);
  const doc = parseTextBlock(markdown);

  it('runs Phase 4’s plugins within 1.5 ms a key', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const editor = createBlockEditor(root, doc, { kind: 'text', block: 'b1', host: testHost() });
    editors.push(editor);
    const bare = EditorState.create({ doc: editor.state.doc, schema: editor.schema });
    // Warm both paths up first, so the JIT compiles them before they are timed.
    typeInto(editor.state);
    typeInto(bare);
    const full = typeInto(editor.state);
    const none = typeInto(bare);
    const plugins = full.map((time, i) => Math.max(0, time - none[i]));
    record(`${fixture} plugins p95`, `${p95(plugins).toFixed(3)} ms (${editor.state.plugins.length} plugins)`);
    expect(p95(plugins)).toBeLessThanOrEqual(PLUGINS_BUDGET_MS * scale);
  });

  it('serializes, splices, and builds the flush request within budget', () => {
    const cold = performance.now();
    const before = serializeTextBlock(doc, createMarkdownCache());
    const coldMs = performance.now() - cold;
    record(
      `${fixture} serialize cold`,
      `${coldMs.toFixed(1)} ms (${((before.length / 1e6 / coldMs) * 1000).toFixed(1)} MB/s)`,
    );
    const cache = createMarkdownCache();
    let state = EditorState.create({ doc });
    let last = serializeTextBlock(state.doc, cache);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, middle(state.doc))));
    const flushes: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      state = state.apply(state.tr.insertText('abc '[i % 4]));
      const start = performance.now();
      const next = serializeTextBlock(state.doc, cache);
      const splice = diffMarkdown(last, next)!;
      JSON.stringify({ block: 'b1', at: utf8Offset(last, splice.at), del: splice.del.length, ins: splice.ins });
      flushes.push(performance.now() - start);
      last = next;
    }
    record(`${fixture} flush p95`, `${p95(flushes.slice(10)).toFixed(2)} ms`);
    expect(p95(flushes.slice(10))).toBeLessThanOrEqual(FLUSH_BUDGET_MS * scale);
  });

  it('re-parses the changed part of an undo frame within budget', () => {
    const cache = createMarkdownCache();
    serializeTextBlock(doc, cache);
    const at = Math.floor(markdown.length / 2);
    const space = markdown.indexOf(' ', at);
    const times: number[] = [];
    let full = 0;
    for (let i = 0; i < 20; i += 1) {
      const next = `${markdown.slice(0, space)} **undone ${i}**${markdown.slice(space)}`;
      const start = performance.now();
      // A change inside one long top-level node, such as the outline's one list, parses the whole text again.
      if (reparseRange(doc, markdown, next, cache) === 'full') {
        full += 1;
        parseTextBlock(next);
      }
      times.push(performance.now() - start);
    }
    const kind = full ? 'full re-parse' : 'range re-parse';
    record(`${fixture} ${kind} p95`, `${p95(times.slice(5)).toFixed(2)} ms`);
    if (fixture === 'twentyPage') expect(full).toBe(0);
    // A full parse has the whole of undo's feedback budget; it leaves nothing for the rest, a known follow-up.
    expect(p95(times.slice(5))).toBeLessThanOrEqual((full ? UNDO_BUDGET_MS : REPARSE_BUDGET_MS) * scale);
  });
});
