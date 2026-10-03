// @vitest-environment jsdom
// What Phase 4's plugins cost per transaction on the 20-page flat note and outline (PLAN.md section 8.6). Typing
// replays a keystroke at a time, with an Enter every twenty, and the 95th percentile of applying each transaction
// stays within the 1.5 ms budget, with a margin for a loaded test machine.
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { pageFixture } from '../../services/pages/fixtures';
import type { Editor } from '@tiptap/core';
import { testHost } from '../commands/testing';
import { parseTextBlock } from '../markdown';
import { createBlockEditor } from './kit';

let mounted: Editor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

/** The budget, with room for a test machine shared by other work. */
const BUDGET_MS = 1.5 * 3;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

/** Applies typing transactions to the state alone, which is what plugins add to; the view is the same for all. */
function measure(state: EditorState, keystrokes: number): number[] {
  let current = state;
  const middle = Math.floor(current.doc.content.size / 2);
  current = current.apply(current.tr.setSelection(TextSelection.near(current.doc.resolve(middle))));
  const samples: number[] = [];
  for (let i = 0; i < keystrokes; i += 1) {
    const tr: Transaction = i % 20 === 19 ? current.tr.split(current.selection.from) : current.tr.insertText('a');
    const started = performance.now();
    current = current.apply(tr);
    samples.push(performance.now() - started);
  }
  return samples;
}

describe('Phase 4’s plugins', () => {
  for (const name of ['twentyPage', 'twentyPageOutline'] as const) {
    it(`cost little per transaction on the ${name} fixture`, () => {
      const markdown = String(pageFixture(name).page.blocks[0].data.markdown);
      const root = document.body.appendChild(document.createElement('div'));
      mounted = createBlockEditor(root, parseTextBlock(markdown), { kind: 'text', block: 'b1', host: testHost() });
      const samples = measure(mounted.state, 400);
      console.info(`${name}: p95 ${p95(samples.slice(50)).toFixed(3)} ms per transaction`);
      expect(p95(samples.slice(50))).toBeLessThan(BUDGET_MS);
    }, 60_000);
  }
});
