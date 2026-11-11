// The Home tab's own tools: split buttons (a main action and a caret with choices), the font and size boxes, and the
// helpers they share. Each reads the target editor's selection again when the bar's tick changes. Owner:
// text:home-tab-ui (B10).
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { commandContext } from '../../../commands/registry';
import { formatChord, shortcutHint, useKeysFor } from '../../../commands/keymap';
import type { CommandId } from '../../../commands/types';
import type { EditorCommandArgs } from '../../../editor/commands/catalog';
import { barTick } from '../../../shell/commandbar/barTick';
import styles from '../../../shell/commandbar/CommandBar.module.css';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Popover, Tooltip, openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import { GLYPH_COMMANDS, iconElementFor } from '../../../ui/commandIcons';
import { targetEditor } from '../formattingBar/target';
import { run } from './run';
import { FontPicker, SizeBox, useFontCatalog } from '../../fonts';
import { fontAt, sizeAt } from './state';

/** Re-renders when the selection or a format changed, and returns the editor the tools act on. */
export function useTarget() {
  useStore(barTick, (now) => now);
  return targetEditor();
}

export { run };

export interface ToolProps {
  toolProps: { tabIndex: -1; 'data-tool': '' };
}

interface SplitProps extends ToolProps {
  /** The command the main button runs. */
  command: CommandId;
  args?: EditorCommandArgs;
  label: string;
  pressed?: boolean | 'mixed';
  /** The current color under the icon, as a resolved value: data, not an accent. */
  swatch?: string | null;
  /** The choices as a menu. */
  items?: () => readonly MenuItemSpec[];
  /** The choices as a popover (a color palette). It gets a function that closes it. */
  panel?: (close: () => void) => ReactNode;
}

/** A glyph button with a caret: the button applies the current choice, the caret opens the others. */
export function SplitButton({ toolProps, command, args, label, pressed, swatch, items, panel }: SplitProps) {
  const keys = useKeysFor(command);
  const caret = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const icon = iconElementFor(command);
  const glyph = GLYPH_COMMANDS.has(command);
  const choose = async () => {
    if (panel) {
      setOpen(true);
      return;
    }
    if (!items || !caret.current) return;
    setOpen(true);
    await openMenu({ label, items: items(), anchor: caret.current, returnFocus: caret.current });
    setOpen(false);
  };
  return (
    <span className={styles.split} role="group" aria-label={label} data-split={command}>
      <Tooltip label={label} shortcut={keys[0] ? formatChord(keys[0]) : undefined} touchHold>
        <button
          type="button"
          {...toolProps}
          className={`${styles.tool} ${styles.withSwatch}`}
          data-kind={glyph ? 'glyph' : 'named'}
          aria-label={label}
          aria-pressed={pressed === undefined ? undefined : pressed}
          aria-keyshortcuts={shortcutHint(command) ?? undefined}
          onClick={() => run(command, args)}
        >
          <span className={styles.toolIcon} aria-hidden="true" data-tool-icon="">
            {icon}
          </span>
          {swatch !== undefined && (
            <span
              className={styles.swatch}
              data-color-swatch=""
              style={{ '--swatch': swatch ?? 'transparent' } as React.CSSProperties}
            />
          )}
        </button>
      </Tooltip>
      <button
        ref={caret}
        type="button"
        {...toolProps}
        className={`${styles.tool} ${styles.caret}`}
        aria-label={t('textHome.options', { name: label })}
        aria-haspopup={panel ? 'dialog' : 'menu'}
        aria-expanded={open}
        onClick={() => void choose()}
      >
        <CaretDownIcon aria-hidden="true" size={12} />
      </button>
      {panel && (
        <Popover anchor={caret} label={label} open={open} onClose={() => setOpen(false)}>
          {panel(() => setOpen(false))}
        </Popover>
      )}
    </span>
  );
}

function useFonts() {
  const client = (() => {
    try {
      return commandContext('commandBar').platform.fonts;
    } catch {
      return { list: () => Promise.resolve([]) };
    }
  })();
  return useFontCatalog(client);
}

/** The font box: blank-looking "Mixed fonts" when the selection mixes fonts. */
export function FontBox() {
  const editor = useTarget();
  const catalog = useFonts();
  const { value } = editor ? fontAt(editor.state) : { value: null };
  const mixed = editor ? fontAt(editor.state).mixed : false;
  const shown = mixed ? null : (value ?? catalog.theme.body);
  return (
    <span className={`${styles.box} ${styles.fontBox}`} data-home-box="font">
      <FontPicker
        catalog={catalog}
        value={shown}
        onPick={(name, weight) => {
          run('format.font', { value: name });
          if (weight !== undefined) run('format.weight', { value: weight });
        }}
      />
    </span>
  );
}

/** The size box: blank when the selection mixes sizes. */
export function SizeControl() {
  const editor = useTarget();
  const { points } = editor ? sizeAt(editor.state) : { points: null };
  return (
    <span className={`${styles.box} ${styles.sizeBox}`} data-home-box="size">
      <SizeBox value={points} onCommit={(next) => run('format.fontSize', { value: next })} />
    </span>
  );
}
