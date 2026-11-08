// The Styles pane (text DESIGN.md 5.3, MATRIX row 158; behind text.styles2): every style of the gallery, each with
// a preview of its look, where it comes from, and a short description. Activating one applies it to the selected
// paragraphs, and the focus stays in the pane so the next one is a key away. Like the Related pages pane, it has no
// slot in the workspace grid, so it renders in a root of its own at the dock.
import { useEffect, useId, useRef } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { setDockInset } from '../../../shell/layout/dock';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, showToast } from '../../../ui';
import { targetEditor } from '../formattingBar/target';
import { applyStyle } from './commands';
import { galleryEntries, lookSummary } from './gallery';
import type { GalleryEntry } from './gallery';
import { notebookStyles, pageSheet, shownContext } from './store';
import styles from './StylesPane.module.css';

/** The preview's largest size, in points, so a 27 pt title still fits the pane. */
const PREVIEW_MAX_PT = 15;

/** The look of an entry as inline CSS for its preview: font, size up to the cap, weight, and italic. */
export function previewStyle(look: GalleryEntry['look']): CSSProperties {
  const out: CSSProperties = {};
  if (typeof look.font === 'string') out.fontFamily = `"${look.font.replace(/["\\]/g, '')}"`;
  if (typeof look.sizePt === 'number') out.fontSize = `${Math.min(look.sizePt, PREVIEW_MAX_PT)}pt`;
  if (typeof look.weight === 'number') out.fontWeight = look.weight;
  if (look.italic === true) out.fontStyle = 'italic';
  return out;
}

/** Applies a style to the selected paragraphs of the shown page, or says why it can't. */
function apply(entry: GalleryEntry, notebook: string, editorOf: () => Editor | null): void {
  const editor = editorOf();
  if (!editor) {
    showToast({ message: t('textStyles.noParagraph') });
    return;
  }
  const ctx = shownContext(notebook);
  applyStyle(editor, entry.name, { ...ctx.app, ...ctx.notebook, ...ctx.page });
}

/** Up and Down move between the styles, Home and End go to the first and last. */
function moveFocus(event: KeyboardEvent<HTMLUListElement>): void {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  const at = buttons.indexOf(event.target as HTMLButtonElement);
  if (at < 0) return;
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus();
}

export interface StylesPaneProps {
  notebook: string;
  onClose(): void;
  /** The editor a chosen style applies to: the shown page's focused or last-used text block. */
  editorOf?: () => Editor | null;
}

export function StylesPane({ notebook, onClose, editorOf = targetEditor }: StylesPaneProps) {
  // Changing a notebook's styles or the page's sheet draws the pane again.
  useStore(notebookStyles, (all) => all[notebook]);
  useStore(pageSheet, (sheet) => sheet);
  const headingId = useId();
  const hintId = useId();
  const list = useRef<HTMLUListElement>(null);
  const entries = galleryEntries(shownContext(notebook));
  // The first style takes the focus when the pane opens, so the keys work at once.
  useEffect(() => list.current?.querySelector('button')?.focus(), []);
  return (
    <section
      aria-labelledby={headingId}
      className={styles.stack}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.head}>
        <h2 id={headingId} className={styles.heading}>
          {t('textStyles.pane.title')}
        </h2>
        <Button variant="quiet" onClick={onClose}>
          {t('textStyles.pane.close')}
        </Button>
      </div>
      <p id={hintId} className={styles.help}>
        {t('textStyles.pane.hint')}
      </p>
      {entries.length > 0 ? (
        <ul ref={list} className={styles.list} aria-describedby={hintId} onKeyDown={moveFocus}>
          {entries.map((entry) => (
            <li key={entry.name}>
              <button
                type="button"
                className={styles.entry}
                data-style-name={entry.name}
                onClick={() => apply(entry, notebook, editorOf)}
              >
                <span className={styles.preview} style={previewStyle(entry.look)}>
                  {entry.label}
                </span>
                <span className={styles.detail}>
                  {[t(`textStyles.source.${entry.source}` as MessageKey), lookSummary(entry.look)]
                    .filter(Boolean)
                    .join('. ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.help}>{t('textStyles.pane.empty')}</p>
      )}
    </section>
  );
}

let host: HTMLElement | null = null;
let root: Root | null = null;
let opener: HTMLElement | null = null;

export function closeStylesPane(): void {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  setDockInset(0, 'styles');
  if (opener?.isConnected) opener.focus();
  opener = null;
}

/** Shows the pane for a notebook, or closes it when it is showing. */
export function toggleStylesPane(notebook: string, editorOf: () => Editor | null = targetEditor): void {
  if (host) {
    closeStylesPane();
    return;
  }
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  host = document.body.appendChild(document.createElement('div'));
  host.className = styles.sheet ?? '';
  host.dataset['region'] = 'styles-pane';
  // The page leaves room for the sheet: its 20 rem, its 16 px gap to the window's edge, and 8 px of air.
  setDockInset(320 + 24, 'styles');
  root = createRoot(host);
  root.render(<StylesPane notebook={notebook} onClose={closeStylesPane} editorOf={editorOf} />);
}
