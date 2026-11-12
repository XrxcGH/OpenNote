// The page's context menu items Font and Paragraph. Each opens a menu at the selection with the same choices as the
// Home tab, so a long press or a right-click reaches every formatting command without the command bar.
import type { CommandTarget } from '../../../commands/types';
import { t } from '../../../strings/t';
import { currentTheme } from '../../../theme/theme';
import { openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import { targetEditor } from '../formattingBar/target';
import {
  borderItems,
  bulletItems,
  caseItems,
  effectItems,
  numberingItems,
  shadeItems,
  spacingItems,
  strikeItems,
  underlineItems,
} from './menus';
import { run } from './run';

const action = (id: string, label: string, command: Parameters<typeof run>[0]): MenuItemSpec => ({
  id,
  label,
  onSelect: () => run(command),
});

const sub = (id: string, label: string, submenu: readonly MenuItemSpec[]): MenuItemSpec => ({
  id,
  label,
  submenu,
});

export function fontMenuItems(): MenuItemSpec[] {
  return [
    action('bold', t('editor.commands.bold'), 'format.bold'),
    action('italic', t('editor.commands.italic'), 'format.italic'),
    sub('underline', t('editor.commands.underline'), underlineItems(currentTheme() === 'dark' ? 'dark' : 'light')),
    sub('strike', t('editor.commands.strike'), strikeItems()),
    action('subscript', t('editor.commands.subscript'), 'format.subscript'),
    action('superscript', t('editor.commands.superscript'), 'format.superscript'),
    sub('effects', t('textCommands.names.effect'), effectItems()),
    sub('case', t('textCommands.names.changeCase'), caseItems()),
    { ...action('clear', t('editor.commands.clear'), 'format.clear'), separatorBefore: true },
  ];
}

export function paragraphMenuItems(): MenuItemSpec[] {
  return [
    action('alignStart', t('textCommands.names.alignStart'), 'para.alignStart'),
    action('alignCenter', t('textCommands.names.alignCenter'), 'para.alignCenter'),
    action('alignEnd', t('textCommands.names.alignEnd'), 'para.alignEnd'),
    action('justify', t('textCommands.names.justify'), 'para.justify'),
    { ...sub('spacing', t('textCommands.names.lineSpacing'), spacingItems()), separatorBefore: true },
    sub('bullets', t('editor.commands.bulletList'), bulletItems()),
    sub('numbering', t('editor.commands.orderedList'), numberingItems()),
    sub('shading', t('textHome.shadingLabel'), shadeItems(currentTheme() === 'dark' ? 'dark' : 'light')),
    sub('borders', t('textHome.bordersLabel'), borderItems()),
    { ...action('indent', t('textCommands.names.indent'), 'para.indent'), separatorBefore: true },
    action('outdent', t('textCommands.names.outdent'), 'para.outdent'),
  ];
}

/** Opens the Font or Paragraph menu at the selection. */
export async function openContextSubmenu(kind: 'font' | 'paragraph', _target?: CommandTarget): Promise<void> {
  const editor = targetEditor();
  if (!editor) return;
  const at = editor.view.coordsAtPos(editor.state.selection.from);
  await openMenu({
    label: t(kind === 'font' ? 'textHome.context.font' : 'textHome.context.paragraph'),
    anchor: { x: at.left, y: at.bottom },
    items: kind === 'font' ? fontMenuItems() : paragraphMenuItems(),
    returnFocus: editor.view.dom,
  });
}
