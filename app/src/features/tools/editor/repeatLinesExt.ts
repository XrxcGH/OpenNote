// A repeating to-do on a page: when a checkbox line that says how often it repeats ("- [ ] Water plants every week")
// is checked, the next one is added under it with its date moved on. The line that was checked stays as it is, so
// the page keeps what was done. Nothing is added when a line is unchecked, when a checked line is pasted in, or when
// the line does not say how often.
import { Extension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Mapping } from '@tiptap/pm/transform';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { nextLineEdit } from '../upcoming/repeatLine';

const LEAF = '\u0000';

/** A checkbox item that was just checked, and the text of its first line. */
interface Checked {
  pos: number;
  item: PMNode;
}

/** The items that changed from unchecked to checked between two states, last first. */
export function newlyChecked(transactions: readonly Transaction[], before: EditorState, after: EditorState): Checked[] {
  const mapping = new Mapping();
  transactions.forEach((tr) => mapping.appendMapping(tr.mapping));
  const back = mapping.invert();
  const found: Checked[] = [];
  after.doc.descendants((node, pos) => {
    if (node.type.name !== 'listItem' || node.attrs.checked !== true) return true;
    const earlier = before.doc.nodeAt(back.map(pos, 1));
    if (earlier?.type === node.type && earlier.attrs.checked === false && earlier.textContent === node.textContent)
      found.push({ pos, item: node });
    return true;
  });
  return found.reverse();
}

/** The next line for a checked one: the same line, unchecked, with its date moved to the next time. Null if it does not repeat. */
export function nextLine(
  item: PMNode,
  now: number,
  timeZone: string,
): { copy: PMNode; edit: { from: number; to: number; text: string } } | null {
  const first = item.firstChild;
  if (!first?.isTextblock) return null;
  const next = nextLineEdit(first.textBetween(0, first.content.size, undefined, LEAF), now, timeZone);
  if (!next) return null;
  // The copy has the first line only: the items under a checked item belong to that one.
  return { copy: item.type.create({ ...item.attrs, checked: false }, Fragment.from(first)), edit: next.edit };
}

const key = new PluginKey('opennoteRepeatLines');

export function repeatLinesExtension(): Extension {
  return Extension.create({
    name: 'opennoteRepeatLines',
    addProseMirrorPlugins: () => [
      new Plugin({
        key,
        appendTransaction(transactions, before, after) {
          if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta(key))) return null;
          const checked = newlyChecked(transactions, before, after);
          if (checked.length === 0) return null;
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const tr = after.tr;
          let added = false;
          for (const { pos, item } of checked) {
            const next = nextLine(item, Date.now(), zone);
            if (!next) continue;
            const insertAt = pos + item.nodeSize;
            tr.insert(insertAt, next.copy);
            // The new item opens, then its first line opens: the text starts two positions in.
            const start = insertAt + 2;
            tr.insertText(next.edit.text, start + next.edit.from, start + next.edit.to);
            added = true;
          }
          return added ? tr.setMeta(key, true) : null;
        },
      }),
    ],
  });
}
