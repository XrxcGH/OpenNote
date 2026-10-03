// Running the outline and fold commands on an editor, with their announcements (owner: WP4). Moves and levels
// change the text as one command; folds change only the view.
import type { Editor } from '@tiptap/core';
import { t } from '../../strings/t';
import { hostOf } from '../extensions/keys';
import { runCommand } from './command';
import { foldKey, foldTargetAt, foldsForLevel, foldsOf, hiddenRanges, setFolds } from './fold';
import { changeLevel, moveItem } from './outline';
import type { OutlineResult } from './outline';

const MOVES: Record<string, ReturnType<typeof moveItem>> = {
  'outline.moveUp': moveItem('up'),
  'outline.moveDown': moveItem('down'),
  'outline.promote': changeLevel(-1),
  'outline.demote': changeLevel(1),
};

export const OUTLINE_IDS: readonly string[] = [
  ...Object.keys(MOVES),
  'outline.fold',
  'outline.unfold',
  'outline.showAll',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => `outline.showLevel${level}`),
];

function outlineText(result: OutlineResult): string {
  switch (result.kind) {
    case 'moved':
      return t(result.direction === 'up' ? 'editor.outline.movedUp' : 'editor.outline.movedDown');
    case 'edge':
      return t(result.direction === 'up' ? 'editor.outline.top' : 'editor.outline.bottom');
    case 'level':
      return result.level === 0 ? t('editor.tab.paragraph') : t('editor.outline.level', { level: result.level });
    case 'maxLevel':
      return t('editor.outline.maxLevel');
    case 'minLevel':
      return t('editor.outline.minLevel');
    default:
      return t('editor.outline.noLevel');
  }
}

/** Whether a fold command can act: folding plugins only run with the outline flag on. */
const folding = (editor: Editor) => foldKey.getState(editor.state) !== undefined;

function runFold(editor: Editor, id: string): boolean {
  if (!folding(editor)) return false;
  const host = hostOf(editor);
  const { state } = editor;
  const folds = foldsOf(state);
  let next: readonly number[];
  let text: string;
  if (id === 'outline.showAll') {
    next = [];
    text = t('editor.fold.all');
  } else if (id.startsWith('outline.showLevel')) {
    const level = Number(id.slice('outline.showLevel'.length));
    next = foldsForLevel(state, level);
    text = t('editor.fold.levels', { level });
  } else {
    const target = foldTargetAt(state);
    if (!target) {
      host?.announce(t('editor.fold.nothing'));
      return false;
    }
    const node = state.doc.nodeAt(target.pos)!;
    const name = (target.kind === 'heading' ? node.textContent : (node.firstChild?.textContent ?? '')).trim();
    if (id === 'outline.fold') {
      next = [...folds, target.pos];
      let count = 0;
      for (const [from, to] of hiddenRanges(state.doc, target.pos)) {
        state.doc.nodesBetween(from, to, (child) => {
          if (child.isTextblock) count += 1;
          return !child.isTextblock;
        });
      }
      text = t('editor.fold.folded', { name, count });
    } else {
      next = folds.filter((pos) => pos !== target.pos);
      text = t('editor.fold.expanded', { name });
    }
  }
  editor.view.dispatch(setFolds(state.tr, next));
  host?.announce(text);
  return true;
}

/** Runs an outline or fold command. Returns false for IDs that aren't outline commands. */
export function runOutline(editor: Editor, id: string): boolean {
  const move = MOVES[id];
  if (!move) return OUTLINE_IDS.includes(id) ? runFold(editor, id) : false;
  const results: OutlineResult[] = [];
  runCommand(editor, (state, dispatch) => {
    results.push(move(state, dispatch));
    return true;
  });
  const result = results.at(-1) ?? { kind: 'noLevel' };
  hostOf(editor)?.announce(outlineText(result));
  return result.kind === 'moved' || result.kind === 'level';
}
