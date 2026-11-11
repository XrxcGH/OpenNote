// The Aa sheet of the compact class (text DESIGN.md 5.1): font, size, B, I, U, S, colors, alignment, lists, and
// styles, with 44 px targets. It renders in a root of its own, like the Styles pane, and stays open while text is
// edited, because every control keeps the selection in the text.
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { CommandId } from '../../../commands/types';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { targetEditor } from '../formattingBar/target';
import { applyStyle } from '../styles/commands';
import { galleryEntries } from '../styles/gallery';
import { shownContext, shownNotebook } from '../styles/store';
import styles from './homeTab.module.css';
import { run } from './run';
import { pressedAt } from './state';
import { FontBox, SizeControl, useTarget } from './tools';

const MARKS: readonly [CommandId, MessageKey, string][] = [
  ['format.bold', 'editor.commands.bold', 'bold'],
  ['format.italic', 'editor.commands.italic', 'italic'],
  ['format.underline', 'editor.commands.underline', 'underline'],
  ['format.strike', 'editor.commands.strike', 'strike'],
];
const ALIGNS: readonly [CommandId, MessageKey][] = [
  ['para.alignStart', 'textCommands.names.alignStart'],
  ['para.alignCenter', 'textCommands.names.alignCenter'],
  ['para.alignEnd', 'textCommands.names.alignEnd'],
  ['para.justify', 'textCommands.names.justify'],
];
const LISTS: readonly [CommandId, MessageKey][] = [
  ['block.bulletList', 'editor.commands.bulletList'],
  ['block.orderedList', 'editor.commands.orderedList'],
  ['block.checklist', 'editor.commands.checklist'],
];
const STYLES = ['normal', 'title', 'h1', 'h2', 'h3', 'quote'];

/** A press keeps the selection in the text. */
const keep = (event: { preventDefault(): void }) => event.preventDefault();

function Choice({ command, name }: { command: CommandId; name: MessageKey }) {
  return (
    <button type="button" className={styles.button} onPointerDown={keep} onClick={() => run(command)}>
      {t(name)}
    </button>
  );
}

function Sheet({ onClose }: { onClose(): void }) {
  const editor = useTarget();
  const ctx = shownContext(shownNotebook());
  const entries = STYLES.flatMap((name) => galleryEntries(ctx).filter((entry) => entry.name === name));
  const apply = (name: string) => {
    const target = targetEditor();
    if (target) applyStyle(target, name, { ...ctx.app, ...ctx.notebook, ...ctx.page });
  };
  return (
    <div className={styles.sheet} role="dialog" aria-label={t('textHome.sheet.label')} data-compact-sheet="">
      <div className={styles.row}>
        <FontBox />
        <SizeControl />
        <button type="button" className={`${styles.button} ${styles.close}`} onClick={onClose}>
          {t('textHome.sheet.close')}
        </button>
      </div>
      <div className={styles.row}>
        {MARKS.map(([command, label, mark]) => (
          <button
            key={command}
            type="button"
            className={styles.button}
            aria-pressed={editor ? pressedAt(editor.state, mark) : false}
            onPointerDown={keep}
            onClick={() => run(command)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <p className={styles.rowLabel}>{t('textHome.sheet.colors')}</p>
        <Choice command="format.textColor" name="textHome.textColor" />
        <Choice command="format.highlight" name="editor.commands.highlight" />
      </div>
      <div className={styles.row}>
        <p className={styles.rowLabel}>{t('textHome.sheet.alignment')}</p>
        {ALIGNS.map(([command, label]) => (
          <Choice key={command} command={command} name={label} />
        ))}
      </div>
      <div className={styles.row}>
        <p className={styles.rowLabel}>{t('textHome.sheet.lists')}</p>
        {LISTS.map(([command, label]) => (
          <Choice key={command} command={command} name={label} />
        ))}
      </div>
      {entries.length > 0 && (
        <div className={styles.row}>
          <p className={styles.rowLabel}>{t('textHome.sheet.styles')}</p>
          {entries.map((entry) => (
            <button
              key={entry.name}
              type="button"
              className={styles.button}
              onPointerDown={keep}
              onClick={() => apply(entry.name)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

let host: HTMLElement | null = null;
let root: Root | null = null;

export function closeCompactSheet(): void {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
}

export function toggleCompactSheet(): void {
  if (host) {
    closeCompactSheet();
    return;
  }
  host = document.createElement('div');
  host.dataset.compactSheetHost = '';
  document.body.append(host);
  root = createRoot(host);
  root.render(<Sheet onClose={closeCompactSheet} />);
}
