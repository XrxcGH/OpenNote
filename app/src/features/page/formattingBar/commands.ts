// How WP4's page commands run (owner: WP4). The start-up registrations load this module on first use. It runs the
// editor command on the target editor, and opens the pickers that commands without arguments need. The pickers are
// text color, text size, highlight color, Turn into, and the link popover.
import type { Editor } from '@tiptap/core';
import { tokens } from '../../../theme/tokens';
import {
  currentTextSize,
  highlightAt,
  runEditorCommand,
  textColorAt,
  commandApplies,
} from '../../../editor/commands/catalog';
import type { EditorCommandArgs } from '../../../editor/commands/catalog';
import { linkAt } from '../../../editor/commands/links';
import { runCommand } from '../../../editor/commands/command';
import { BLOCK_KINDS } from '../../../editor/commands/turnInto';
import type { BlockKind } from '../../../editor/commands/turnInto';
import { HIGHLIGHT_COLORS, TEXT_SIZES, linkKind, schemeOf } from '../../../editor/schema/constants';
import { blockKindAt } from '../../../editor/commands/state';
import type { MenuAnchor, MenuItemSpec } from '../../../ui';
import type { TextSizeName } from '../../../editor/schema/specs';
import type { NodeId } from '../../../services/notes/types';
import { openMenu, showToast } from '../../../ui';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import type { CommandContext } from '../../../commands/types';
import { shownPool } from '../pool/shown';
import { pageSelection } from '../seams/selectionStore';
import { targetEditor } from './target';

/** The caret's place on screen, or the focused control (a bar button), for a picker to open at. */
function anchorFor(editor: Editor): MenuAnchor {
  const active = document.activeElement;
  if (active instanceof HTMLElement && !editor.view.dom.contains(active) && active !== document.body) return active;
  try {
    const at = editor.view.coordsAtPos(editor.state.selection.head);
    return { x: at.left, y: at.bottom };
  } catch {
    return editor.view.dom;
  }
}

async function pick(editor: Editor, label: string, items: MenuItemSpec[]): Promise<string | null> {
  return openMenu({ label, items, anchor: anchorFor(editor), returnFocus: editor.view.dom });
}

const radio = (id: string, label: string, checked: boolean): MenuItemSpec => ({ id, label, kind: 'radio', checked });

/** The pens in token order, then Automatic (no color). Custom colors come from the text styles dialog. */
export function textColorItems(current: string | null): MenuItemSpec[] {
  const pens = tokens.ink.pens.map((pen) => pen.name.toLowerCase());
  return [
    ...pens.map((pen) => radio(pen, t(`commands.colors.${pen}` as MessageKey), current === pen)),
    { ...radio('none', t('editor.colorMenu.automatic'), current === null), separatorBefore: true },
    { id: 'custom', label: t('editor.colorMenu.custom'), kind: 'radio', checked: current?.startsWith('#') ?? false },
  ];
}

/** A color from the text color menu: a pen, null for Automatic, or a custom one asked for. */
async function chosenColor(chosen: string, current: string | null): Promise<string | null | undefined> {
  if (chosen === 'none') return null;
  if (chosen !== 'custom') return chosen;
  const { chooseCustomColor } = await import('../styles/CustomColor');
  return (await chooseCustomColor(current?.startsWith('#') ? current : '#')) ?? undefined;
}

export function highlightItems(current: string | null | undefined): MenuItemSpec[] {
  return [
    radio('honey', t('editor.highlightColors.honey'), current === null),
    ...HIGHLIGHT_COLORS.map((color) => radio(color, t(`editor.highlightColors.${color}`), current === color)),
    { ...radio('none', t('editor.highlightColors.none'), current === undefined), separatorBefore: true },
  ];
}

export function textSizeItems(current: string | null): MenuItemSpec[] {
  const sizes = ['small', 'normal', ...TEXT_SIZES.filter((size) => size !== 'small')] as const;
  return sizes.map((size) => radio(size, t(`editor.sizes.${size}`), (current ?? 'normal') === size));
}

const KIND_TITLES: Record<BlockKind, MessageKey> = {
  paragraph: 'editor.commands.normal',
  heading1: 'editor.commands.heading1',
  heading2: 'editor.commands.heading2',
  heading3: 'editor.commands.heading3',
  heading4: 'editor.commands.heading4',
  heading5: 'editor.commands.heading5',
  heading6: 'editor.commands.heading6',
  bulletList: 'editor.commands.bulletList',
  orderedList: 'editor.commands.orderedList',
  checklist: 'editor.commands.checklist',
  quote: 'editor.commands.quote',
  callout: 'editor.commands.callout',
  codeBlock: 'editor.commands.codeBlock',
};

export function turnIntoItems(current: BlockKind | null): MenuItemSpec[] {
  return BLOCK_KINDS.map((kind) => radio(kind, t(KIND_TITLES[kind]), current === kind));
}

async function chooseAndRun(editor: Editor, id: string, args: EditorCommandArgs): Promise<void> {
  if (id === 'format.textColor' && args.color === undefined) {
    const current = textColorAt(editor.state);
    const chosen = await pick(editor, t('editor.colorMenu.label'), textColorItems(current));
    const color = chosen ? await chosenColor(chosen, current) : undefined;
    if (color !== undefined) runEditorCommand(editor, id, { color });
    return;
  }
  if (id === 'format.textSize' && args.size === undefined) {
    const chosen = await pick(editor, t('editor.sizeMenu'), textSizeItems(currentTextSize(editor.state)));
    if (chosen) runEditorCommand(editor, id, { size: chosen === 'normal' ? null : (chosen as TextSizeName) });
    return;
  }
  if (id === 'block.turnInto' && !args.kind) {
    const chosen = await pick(editor, t('editor.turnIntoMenu'), turnIntoItems(blockKindAt(editor.state)));
    if (chosen) runEditorCommand(editor, id, { kind: chosen as BlockKind });
    return;
  }
  if (id === 'format.link' && args.href === undefined) {
    const { openLinkPopover } = await import('../linkPopover/LinkPopover');
    return openLinkPopover(editor);
  }
  runEditorCommand(editor, id, args);
}

/** Opens the highlight color menu and applies the color chosen. */
export async function chooseHighlight(editor: Editor): Promise<void> {
  const chosen = await pick(editor, t('editor.highlightMenu'), highlightItems(highlightAt(editor.state)));
  if (!chosen) return;
  runEditorCommand(editor, 'format.highlight', { color: chosen === 'honey' ? null : chosen });
}

/** Runs a WP4 page command on the target editor. */
export async function runFormatting(id: string, args: EditorCommandArgs | undefined): Promise<void> {
  const editor = targetEditor();
  if (!editor) return;
  await chooseAndRun(editor, id, args ?? {});
}

/** Whether a command would change the target editor's document now. */
export function formattingApplies(id: string, args?: EditorCommandArgs): boolean {
  const editor = targetEditor();
  return editor !== null && commandApplies(id, editor.state, args);
}

/** Sets the text color of every selected text block, as one command per block. */
export async function setBlocksColor(color: string | null | undefined, ctx: CommandContext): Promise<void> {
  const pool = shownPool.get();
  const blocks = pageSelection.get().blocks;
  if (!pool || blocks.length === 0) return;
  let value = color;
  if (value === undefined) {
    const anchor = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    const chosen = await openMenu({ label: t('editor.colorMenu.label'), items: textColorItems(null), anchor });
    value = chosen ? await chosenColor(chosen, null) : undefined;
    if (value === undefined) return;
  }
  for (const block of blocks) {
    const editor = pool.editor(block) ?? pool.mount(block, null, 'target');
    if (!editor) continue;
    runCommand(
      editor,
      (state, dispatch) => {
        const type = state.schema.marks.textColor;
        const tr = state.tr;
        if (value === null) tr.removeMark(0, state.doc.content.size, type);
        else tr.addMark(0, state.doc.content.size, type.create({ color: value }));
        if (!tr.docChanged) return false;
        dispatch?.(tr);
        return true;
      },
      { focus: false },
    );
  }
  ctx.announce(t('editor.announce.block', { name: t('editor.commands.textColor') }));
}

/** The link under the target editor's caret, for the link menu. */
function targetLink(): { href: string; editor: Editor } | null {
  const editor = targetEditor();
  const link = editor ? linkAt(editor.state) : null;
  return editor && link ? { href: link.href, editor } : null;
}

/** Opens the link at the caret: web and mail links in the browser, OpenNote links in the app; others never. */
export async function openLinkAtCaret(ctx: CommandContext): Promise<void> {
  const link = targetLink();
  if (!link) return;
  const kind = linkKind(link.href);
  if (kind === 'inert' || kind === 'asset') {
    showToast({ message: t('editor.link.inert', { scheme: schemeOf(link.href) ?? '' }) });
    return;
  }
  if (kind === 'opennote') {
    const page = /^opennote:(?:\/\/)?page\/([^#?]+)/i.exec(link.href)?.[1];
    if (page) ctx.navigate({ view: 'workspace', notebookId: null, sectionId: null, pageId: page as NodeId });
    else showToast({ message: t('editor.link.inert', { scheme: 'opennote' }) });
    return;
  }
  await ctx.platform.shell.openExternal({ kind: 'link', url: link.href });
}

export async function copyLinkAtCaret(ctx: CommandContext): Promise<void> {
  const link = targetLink();
  if (!link) return;
  await navigator.clipboard.writeText(link.href);
  ctx.announce(t('editor.link.copied'));
}

export { linkAt };
