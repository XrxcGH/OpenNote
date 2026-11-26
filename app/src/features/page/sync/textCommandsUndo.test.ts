// @vitest-environment jsdom
// The text formatting commands through the core (text DESIGN.md 8): each command is one step the sync sends, so one
// Undo reverts it. The format painter makes one step per application, also when it is locked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEditorCommand } from '../../../editor/commands/catalog';
import type { EditorCommandArgs } from '../../../editor/commands/catalog';
import { painterSelectionDone, startPainter, stopPainter } from '../../../editor/commands/painter';
import { blockId, syncPage, syncRig } from './testSync';
import type { SyncRig } from './testSync';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn() }));

const A = blockId(1);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const held = async (rig: SyncRig) => String((await rig.held()).blocks[0].data.markdown);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  stopPainter();
  vi.useRealTimers();
  document.body.replaceChildren();
});

const COMMANDS: [string, EditorCommandArgs][] = [
  ['format.bold', {}],
  ['format.font', { value: 'Georgia' }],
  ['format.fontSize', { value: 15 }],
  ['format.growFont', {}],
  ['format.fontSizeDown', {}],
  ['format.weight', { value: 600 }],
  ['format.strikeDouble', {}],
  ['format.underlineStyle', { value: 'wave' }],
  ['format.smallCaps', {}],
  ['format.tracking', { value: '2' }],
  ['format.changeCase', { value: 'upper' }],
  ['format.cycleCase', {}],
  ['format.clearCharacter', {}],
  ['format.clearAll', {}],
];

describe('each text command through the core', () => {
  it.each(COMMANDS)('%s is exactly one undo step', async (id, args) => {
    const source = '<span data-size="11">**two** words</span>';
    const rig = await syncRig(syncPage([source]));
    const editor = rig.editors.get(A)!;
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    const before = rig.sent().length;
    expect(runEditorCommand(editor, id, args)).toBe(true);
    await tick(0);
    expect(rig.sent().length - before).toBe(1);
    expect(await held(rig)).not.toBe(source);
    await rig.page.undo();
    expect(await held(rig)).toBe(source);
  });
});

describe('the format painter', () => {
  const SOURCE =
    '<span data-color="brick"><span data-font="Georgia"><span data-size="14">aaa</span></span></span> bbb ccc ddd';
  const painted = (word: string) =>
    `<span data-color="brick"><span data-font="Georgia"><span data-size="14">${word}</span></span></span>`;

  it('copies font, size, and color to the next selection in one undo step', async () => {
    const rig = await syncRig(syncPage([SOURCE]));
    const editor = rig.editors.get(A)!;
    editor.commands.setTextSelection(2);
    startPainter(editor);
    editor.commands.setTextSelection({ from: 5, to: 8 });
    const before = rig.sent().length;
    expect(painterSelectionDone(editor)).toBe(true);
    await tick(0);
    expect(rig.sent().length - before).toBe(1);
    expect(await held(rig)).toContain(painted('bbb'));
    editor.commands.setTextSelection({ from: 9, to: 12 });
    expect(painterSelectionDone(editor)).toBe(false);
    await rig.page.undo();
    expect(await held(rig)).toBe(SOURCE);
  });

  it('applies three times in three steps when locked', async () => {
    const rig = await syncRig(syncPage([SOURCE]));
    const editor = rig.editors.get(A)!;
    editor.commands.setTextSelection(2);
    startPainter(editor, { locked: true });
    const before = rig.sent().length;
    for (const [from, to] of [
      [5, 8],
      [9, 12],
      [13, 16],
    ]) {
      editor.commands.setTextSelection({ from, to });
      expect(painterSelectionDone(editor)).toBe(true);
      await tick(0);
    }
    expect(rig.sent().length - before).toBe(3);
    expect(await held(rig)).toContain(painted('ddd'));
    await rig.page.undo();
    const once = await held(rig);
    expect(once).toContain(painted('ccc'));
    expect(once).not.toContain(painted('ddd'));
    await rig.page.undo();
    await rig.page.undo();
    expect(await held(rig)).toBe(SOURCE);
  });
});
