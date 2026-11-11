// The Home tab's tool components, one per control that is more than a plain button. The registrations load them
// lazily, so start-up holds only the definitions. Owner: text:home-tab-ui (B10).
import { useRef, useState } from 'react';
import type { CommandId } from '../../../commands/types';
import styles from '../../../shell/commandbar/CommandBar.module.css';
import { t } from '../../../strings/t';
import { useResolvedTheme } from '../../../theme/theme';
import { Tooltip, openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import { ColorPalette, resolveColor } from '../../../ui/color';
import type { ColorPick, Scheme } from '../../../ui/color';
import { GLYPH_COMMANDS, iconElementFor } from '../../../ui/commandIcons';
import {
  borderItems,
  bulletItems,
  caseItems,
  effectItems,
  numberingItems,
  multilevelItems,
  selectItems,
  shadeItems,
  spacingItems,
  strikeItems,
  swatchIcon,
  underlineItems,
} from './menus';
import { shownNotebook } from '../styles/store';
import { colorAt, lastColor, pressedAt, rememberColor } from './state';
import { SplitButton, run, useTarget } from './tools';
import type { ToolProps } from './tools';

export { FontBox, SizeControl } from './tools';

const useScheme = (): Scheme => (useResolvedTheme() === 'dark' ? 'dark' : 'light');

const swatchOf = (value: string | null, scheme: Scheme): string | null => (value ? resolveColor(value, scheme) : null);

export function UnderlineTool({ toolProps }: ToolProps) {
  const editor = useTarget();
  const scheme = useScheme();
  return (
    <SplitButton
      toolProps={toolProps}
      command="format.underline"
      label={t('editor.commands.underline')}
      pressed={editor ? pressedAt(editor.state, 'underline') : false}
      items={() => underlineItems(scheme)}
    />
  );
}

export function StrikeTool({ toolProps }: ToolProps) {
  const editor = useTarget();
  return (
    <SplitButton
      toolProps={toolProps}
      command="format.strike"
      label={t('editor.commands.strike')}
      pressed={editor ? pressedAt(editor.state, 'strike') : false}
      items={strikeItems}
    />
  );
}

/** The highlight choices: the five highlighters and None, each with its swatch. */
function highlightItems(scheme: Scheme): MenuItemSpec[] {
  const names = ['honey', 'mint', 'rose', 'apricot', 'lilac'] as const;
  return [
    ...names.map((name) => ({
      id: `highlight.${name}`,
      label: t(`textHome.shading.${name}`),
      icon: swatchIcon(resolveColor(name, scheme) ?? 'transparent'),
      onSelect: () => {
        rememberColor('highlight', name);
        run('format.highlight', { color: name === 'honey' ? null : name });
      },
    })),
    {
      id: 'highlight.none',
      label: t('textHome.highlight.none'),
      separatorBefore: true,
      onSelect: () => run('format.highlight', { color: 'none' }),
    },
  ];
}

export function HighlightTool({ toolProps }: ToolProps) {
  const editor = useTarget();
  const scheme = useScheme();
  const color = editor ? colorAt(editor.state, 'highlight') : null;
  const on = editor ? pressedAt(editor.state, 'highlight') !== false : false;
  const last = lastColor('highlight');
  return (
    <SplitButton
      toolProps={toolProps}
      command="format.highlight"
      // Applies the last highlight picked, and takes it off when the selection has one.
      args={{ color: on ? 'none' : last === 'honey' ? null : last }}
      label={t('editor.commands.highlight')}
      pressed={editor ? pressedAt(editor.state, 'highlight') : false}
      swatch={swatchOf(color ?? last, scheme)}
      items={() => highlightItems(scheme)}
    />
  );
}

export function TextColorTool({ toolProps }: ToolProps) {
  const editor = useTarget();
  const scheme = useScheme();
  const current = editor ? colorAt(editor.state, 'textColor') : null;
  const pick = (choice: ColorPick, close: () => void) => {
    close();
    if (choice.kind === 'color') {
      rememberColor('textColor', choice.value);
      run('format.textColor', { color: choice.value });
    } else if (choice.kind === 'auto') run('format.textColor', { color: null });
  };
  return (
    <SplitButton
      toolProps={toolProps}
      command="format.textColor"
      args={{ color: lastColor('textColor') }}
      label={t('textHome.textColor')}
      swatch={swatchOf(current ?? lastColor('textColor'), scheme)}
      panel={(close) => (
        <ColorPalette
          scheme={scheme}
          noColor
          notebookId={shownNotebook() ?? undefined}
          current={current}
          onPick={(choice) => pick(choice, close)}
        />
      )}
    />
  );
}

export function BulletsTool({ toolProps }: ToolProps) {
  const editor = useTarget();
  return (
    <SplitButton
      toolProps={toolProps}
      command="block.bulletList"
      label={t('editor.commands.bulletList')}
      pressed={editor ? editor.isActive('bulletList') : false}
      items={bulletItems}
    />
  );
}

export function NumberingTool({ toolProps }: ToolProps) {
  const editor = useTarget();
  return (
    <SplitButton
      toolProps={toolProps}
      command="block.orderedList"
      label={t('editor.commands.orderedList')}
      pressed={editor ? editor.isActive('orderedList') : false}
      items={numberingItems}
    />
  );
}

const MENUS: Readonly<Record<string, (scheme: Scheme) => MenuItemSpec[]>> = {
  'format.changeCase': () => caseItems(),
  'format.effect': () => effectItems(),
  'list.multilevel': () => multilevelItems(),
  'para.lineSpacing': () => spacingItems(),
  'para.shade': (scheme) => shadeItems(scheme),
  'para.border': () => borderItems(),
  'text.select': () => selectItems(),
};

/** A named tool with an icon that opens a menu of choices (change case, effects, spacing, shading, borders). */
export function MenuTool({ toolProps, command, label }: ToolProps & { command: CommandId; label: string }) {
  const scheme = useScheme();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const icon = iconElementFor(command);
  const choose = async () => {
    const build = MENUS[command];
    if (!build || !ref.current) return;
    setOpen(true);
    await openMenu({ label, items: build(scheme), anchor: ref.current, returnFocus: ref.current });
    setOpen(false);
  };
  return (
    <Tooltip label={label}>
      <button
        ref={ref}
        type="button"
        {...toolProps}
        className={styles.tool}
        data-kind={GLYPH_COMMANDS.has(command) ? 'glyph' : 'named'}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => void choose()}
      >
        <span className={styles.toolIcon} aria-hidden="true" data-tool-icon="">
          {icon}
        </span>
        <span className={styles.label}>
          <span>{label}</span>
          <span className={styles.labelSizer} aria-hidden="true">
            {label}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}
