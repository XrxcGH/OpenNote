// @vitest-environment jsdom
// The tab layout on the typing path (text DESIGN.md 7.2). A key's transaction must not walk the whole document: with
// 2,000 paragraphs and one tab, the layout plugin costs about what it costs on 20 paragraphs. The cost is the
// plugin state's apply, timed against a state with no plugins, as in the Phase 4 typing bench.
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { parseTextBlock } from '../markdown/parse';
import { tabLayoutPlugin } from './tabLayout';

const KEYS = 200;
const ROUNDS = 5;

/** A note of `count` paragraphs. The one in the middle holds a tab. */
function note(count: number): PMNode {
  const paragraphs = Array.from({ length: count }, (_, i) =>
    i === Math.floor(count / 2) ? `Total\t12.50` : `Paragraph ${i} has a few ordinary words in it.`,
  );
  return parseTextBlock(paragraphs.join('\n\n'));
}

/** A caret inside the first paragraph past the middle that holds no tab. */
function caretIn(doc: PMNode): number {
  let found = -1;
  doc.forEach((node, offset) => {
    if (found < 0 && offset >= doc.content.size / 2 && !node.textContent.includes('\t')) found = offset + 3;
  });
  return found;
}

function typeInto(start: EditorState): number[] {
  let state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, caretIn(start.doc))));
  const times: number[] = [];
  for (let i = 0; i < KEYS; i += 1) {
    const tr = state.tr.insertText('abc '[i % 4]);
    const before = performance.now();
    state = state.apply(tr);
    times.push(performance.now() - before);
  }
  return times;
}

const total = (times: readonly number[]) => times.reduce((sum, time) => sum + time, 0);

/** The plugin's cost for all the keys in ms. It is the best of several rounds, so a stall does not count. */
function pluginCost(doc: PMNode): number {
  const full = EditorState.create({ doc, plugins: [tabLayoutPlugin()] });
  const bare = EditorState.create({ doc });
  typeInto(full);
  typeInto(bare);
  let best = Infinity;
  for (let round = 0; round < ROUNDS; round += 1) best = Math.min(best, total(typeInto(full)) - total(typeInto(bare)));
  return Math.max(0, best);
}

describe('the tab layout on the typing path', () => {
  it('costs about the same a key in 2,000 paragraphs as in 20', () => {
    const small = pluginCost(note(20));
    const large = pluginCost(note(2000));
    console.log(`[tab layout bench] ${KEYS} keys: 20 paragraphs ${small.toFixed(2)} ms, 2,000 ${large.toFixed(2)} ms`);
    // A walk of the whole document on each key costs 100 times more in 2,000 paragraphs. Work on the changed
    // paragraph only costs the same, plus mapping one tab. The 20 ms of slack absorbs timer noise and a GC pause on
    // a loaded 2-core runner; a whole-document walk still costs far more than that.
    expect(large).toBeLessThan(small * 4 + 20);
  });

  it('finds the tab of the paragraph a key types into', () => {
    const doc = note(20);
    const plugin = tabLayoutPlugin();
    let state = EditorState.create({ doc, plugins: [plugin] });
    state = state.apply(state.tr.insertText('\t', caretIn(doc)));
    // The middle paragraph's tab and the new one.
    expect(plugin.getState(state)!.decorations.find()).toHaveLength(2);
    state = state.apply(state.tr.delete(caretIn(doc), caretIn(doc) + 1));
    expect(plugin.getState(state)!.decorations.find()).toHaveLength(1);
  });
});
