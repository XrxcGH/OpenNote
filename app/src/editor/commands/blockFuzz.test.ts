// @vitest-environment jsdom
// A bounded random test of every editor key and block command over lists. The nightly soak's seeds 87 and 91 each
// found one Enter that threw, so this test looks for the whole class at once.
//
// Each case builds a document of lists: bullet, numbered, and task lists, nested, with items of several paragraphs.
// The lists sit side by side and next to quotes, callouts, headings, and dividers. A case picks a selection and runs
// a few keys, commands, pastes, and typed text. Nothing may throw. The document must fit the schema, and a text
// selection must end in text. listEdits.test.ts keeps each failure this test found as a case of its own.
import { getExtensionField, getSchemaTypeByName } from '@tiptap/core';
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { AllSelection, NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../clipboard/index';
import '../extensions/direction';
import '../extensions/invisibles';
import { BLOCK_KINDS } from './turnInto';
import { EDITOR_COMMAND_IDS, runEditorCommand } from './catalog';
import type { EditorCommandArgs } from './catalog';
import { OUTLINE_IDS } from './outlineRun';
import { mountEditor, pressKey, stateProblem, typeInto } from './testing';
import type { TestEditor } from './testing';

/** The soak's own generator, so a failing case can be found again from its seed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;
const below = (random: Random, n: number) => Math.floor(random() * n);
const pick = <T>(random: Random, items: readonly T[]): T => items[below(random, items.length)];

const WORDS = ['ab', 'cd', 'ef', 'gh', ''];
const text = (random: Random): JSONContent[] => {
  const word = pick(random, WORDS);
  return word ? [{ type: 'text', text: word }] : [];
};
const paragraph = (random: Random): JSONContent => ({ type: 'paragraph', content: text(random) });

function list(random: Random, depth: number): JSONContent {
  const type = random() < 0.5 ? 'bulletList' : 'orderedList';
  const task = type === 'bulletList' && random() < 0.4;
  const items = Array.from({ length: 1 + below(random, 3) }, () => {
    const content = [paragraph(random)];
    if (random() < 0.3) content.push(paragraph(random));
    if (depth < 2 && random() < 0.35) content.push(list(random, depth + 1));
    return { type: 'listItem', attrs: { checked: task ? random() < 0.5 : null }, content };
  });
  return { type, content: items };
}

function block(random: Random): JSONContent {
  const roll = random();
  if (roll < 0.45) return list(random, 0);
  if (roll < 0.6) return paragraph(random);
  if (roll < 0.7) return { type: 'heading', attrs: { level: 1 + below(random, 3) }, content: text(random) };
  if (roll < 0.8) return { type: 'blockquote', content: [random() < 0.5 ? list(random, 1) : paragraph(random)] };
  if (roll < 0.87) {
    return { type: 'callout', content: [{ type: 'calloutTitle', content: text(random) }, paragraph(random)] };
  }
  if (roll < 0.93) return { type: 'horizontalRule' };
  return { type: 'codeBlock', content: text(random) };
}

const documentOf = (random: Random): JSONContent => ({
  type: 'doc',
  content: Array.from({ length: 2 + below(random, 4) }, () => block(random)),
});

/** The positions inside text in a document, in order. */
function textPositions(doc: PMNode): number[] {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.inlineContent) return true;
    for (let at = pos + 1; at <= pos + 1 + node.content.size; at += 1) found.push(at);
    return false;
  });
  return found;
}

/** The text positions inside the first list, or null when there is none. */
function listRange(doc: PMNode): [number, number] | null {
  let range: [number, number] | null = null;
  doc.descendants((node, pos) => {
    if (range) return false;
    if (node.type.name !== 'bulletList' && node.type.name !== 'orderedList') return true;
    const inside = textPositions(node).map((at) => at + pos + 1);
    range = [inside[0], inside[inside.length - 1]];
    return false;
  });
  return range;
}

/**
 * A selection of a kind a person makes. It is a caret, a range in one block, or a range across blocks: across items,
 * or across a list and the block next to it. It can also be a whole list, everything, or a selected block. The last
 * kind is a caret given by a number anywhere in the document, as an undo gives one back.
 */
function selectionFor(random: Random, editor: Editor): string {
  const { doc } = editor.state;
  const texts = textPositions(doc);
  const tr = editor.state.tr;
  const kind = texts.length === 0 ? 4 : below(random, 7);
  if (kind === 0) {
    tr.setSelection(TextSelection.create(doc, pick(random, texts)));
  } else if (kind === 1 || kind === 2) {
    const a = pick(random, texts);
    const b = pick(random, texts);
    tr.setSelection(TextSelection.create(doc, Math.min(a, b), Math.max(a, b)));
  } else if (kind === 3) {
    const range = listRange(doc) ?? [texts[0], texts[texts.length - 1]];
    tr.setSelection(TextSelection.create(doc, range[0], range[1]));
  } else if (kind === 4) {
    tr.setSelection(new AllSelection(doc));
  } else if (kind === 5) {
    const blocks: number[] = [];
    doc.descendants((node, pos) => {
      if (node.isBlock && NodeSelection.isSelectable(node)) blocks.push(pos);
    });
    if (blocks.length === 0) return selectionFor(random, editor);
    tr.setSelection(NodeSelection.create(doc, pick(random, blocks)));
  } else {
    const anchor = below(random, doc.content.size + 1);
    const head = random() < 0.5 ? anchor : below(random, doc.content.size + 1);
    editor.commands.setTextSelection({ from: anchor, to: head });
    return `setTextSelection(${anchor}, ${head})`;
  }
  editor.view.dispatch(tr);
  return JSON.stringify(editor.state.selection.toJSON());
}

/** Every key an editor extension binds, as ProseMirror names it ("Mod-Shift-Enter"). */
function boundKeys(editor: Editor): string[] {
  const keys = new Set<string>(['Enter', 'Backspace', 'Delete', 'Tab', 'Shift-Tab', 'Shift-Enter']);
  for (const extension of editor.extensionManager.extensions) {
    const context = {
      name: extension.name,
      options: extension.options,
      storage: editor.extensionStorage[extension.name as keyof typeof editor.extensionStorage],
      editor,
      type: getSchemaTypeByName(extension.name, editor.schema),
    };
    const shortcuts = getExtensionField<() => Record<string, unknown>>(extension, 'addKeyboardShortcuts', context);
    for (const name of Object.keys(shortcuts?.() ?? {})) keys.add(name);
  }
  // The page's own undo and redo keys go to the page's history, which a lone editor doesn't have.
  return [...keys].filter((name) => !/^Mod-(Shift-)?[zZyY]$/.test(name)).sort();
}

/** The command IDs with the arguments a person can give them. */
function commandCalls(): [string, EditorCommandArgs][] {
  const calls: [string, EditorCommandArgs][] = [...EDITOR_COMMAND_IDS, ...OUTLINE_IDS].map((id) => [id, {}]);
  for (const kind of BLOCK_KINDS) calls.push(['block.turnInto', { kind }]);
  for (const value of [0, 1, 3]) calls.push(['list.setValue', { value }]);
  return calls;
}

const PASTES = [
  '<ul><li><p>pa</p></li><li><p>pb</p></li></ul>',
  '<ol><li><p>pc</p><ul><li><p>pd</p></li></ul></li></ol>',
  '<p>pe</p><ul><li><p>pf</p></li></ul><p>pg</p>',
  '<li><p>ph</p></li>',
  '<blockquote><p>pi</p></blockquote>',
];
const TYPED = ['- ', '1. ', '[ ] ', '> ', '## ', '/', 'x'];

/** jsdom has no ClipboardEvent, so a paste gets a plain event with no clipboard data. */
const pasteEvent = () => new Event('paste', { cancelable: true }) as ClipboardEvent;

type Action = { name: string; run: (editor: Editor) => void };

function actions(editor: Editor): Action[] {
  const keys: Action[] = boundKeys(editor).map((name) => ({ name: `key ${name}`, run: (ed) => pressKey(ed, name) }));
  const commands: Action[] = commandCalls().map(([id, args]) => ({
    name: `command ${id} ${JSON.stringify(args)}`,
    run: (ed) => void runEditorCommand(ed, id, args),
  }));
  const pastes: Action[] = PASTES.map((html) => ({
    name: `paste ${html}`,
    run: (ed) => void ed.view.pasteHTML(html, pasteEvent()),
  }));
  const typed: Action[] = TYPED.map((chars) => ({ name: `type "${chars}"`, run: (ed) => typeInto(ed, chars) }));
  const cut: Action = { name: 'cut', run: (ed) => ed.view.dispatch(ed.state.tr.deleteSelection()) };
  return [...keys, ...commands, ...pastes, ...typed, cut];
}

let mounted: TestEditor;
let all: Action[];
beforeAll(() => {
  mounted = mountEditor('[]x');
  all = actions(mounted.editor);
});
afterAll(() => mounted.destroy());

/** Runs `cases` random cases from `seed` and returns the failures, each with what reproduces it. */
function fuzz(seed: number, cases: number, steps: number): string[] {
  const random = seeded(seed);
  const failures = new Set<string>();
  const { editor } = mounted;
  for (let index = 0; index < cases; index += 1) {
    const doc = documentOf(random);
    editor.commands.setContent(doc);
    editor.view.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc)));
    const selection = selectionFor(random, editor);
    const placed = stateProblem(editor);
    if (placed) {
      failures.add(`${selection}: ${placed} (seed ${seed}, case ${index})`);
      continue;
    }
    const done: string[] = [];
    for (let step = 0; step < steps; step += 1) {
      const action = pick(random, all);
      done.push(action.name);
      let found: string | null;
      try {
        action.run(editor);
        found = stateProblem(editor);
      } catch (error) {
        const at = (error as Error).stack
          ?.split('\n')
          .slice(1, 4)
          .map((line) => line.trim())
          .join(' < ');
        found = `threw ${String(error)} ${at ?? ''}`;
      }
      if (found) {
        failures.add(
          `${action.name}: ${found} (seed ${seed}, case ${index}, selection ${selection}, ran ${done.join(' > ')})`,
        );
        break;
      }
    }
  }
  return [...failures];
}

describe('every key and block command over lists', () => {
  it('binds the list keys the test means to press', () => {
    const names = all.map((action) => action.name);
    for (const name of ['key Enter', 'key Backspace', 'key Delete', 'key Tab', 'key Shift-Tab']) {
      expect(names).toContain(name);
    }
    expect(names).toContain('command block.bulletList {}');
  });

  for (const seed of [1, 2, 3, 91]) {
    it(`keeps a valid document and selection (seed ${seed})`, () => {
      expect(fuzz(seed, 400, 5)).toEqual([]);
    });
  }
});
