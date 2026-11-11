// The Home tab's styles gallery: the first styles of the shown notebook as tiles that show their own look, with the
// hovered or focused tile's name and look read out under them. A tile applies its style in one step; More opens the
// Styles pane. Owner: text:home-tab-ui (B10).
import { useEffect, useRef, useState } from 'react';
import { executeCommand } from '../../../commands/registry';
import styles from '../../../shell/commandbar/CommandBar.module.css';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { VisuallyHidden } from '../../../ui/VisuallyHidden';
import { targetEditor } from '../formattingBar/target';
import { galleryEntries, lookSummary } from '../styles/gallery';
import type { GalleryEntry } from '../styles/gallery';
import { applyStyle, styleOfNode } from '../styles/commands';
import { notebookStyles, loadStyles, shownContext, shownNotebook } from '../styles/store';
import { textSeams } from '../textSeams';
import { useTarget } from './tools';

/** The styles the gallery shows first, in this order, when the notebook has them. */
const FIRST = ['normal', 'title', 'subtitle', 'h1', 'h2', 'h3', 'quote'];

function tileStyle(look: GalleryEntry['look']): React.CSSProperties {
  const size = typeof look.sizePt === 'number' ? Math.min(Math.max(look.sizePt, 10), 16) : 13;
  return {
    fontSize: `${size}px`,
    fontWeight: typeof look.weight === 'number' ? look.weight : undefined,
    fontStyle: look.italic === true ? 'italic' : undefined,
  };
}

export function StylesGallery() {
  const editor = useTarget();
  useStore(notebookStyles, (now) => now);
  const notebook = shownNotebook();
  const [preview, setPreview] = useState<GalleryEntry | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (notebook) void loadStyles(notebook).catch(() => undefined);
  }, [notebook]);
  useEffect(() => {
    // Ctrl+Shift+S moves focus to the gallery.
    textSeams.set((seams) => ({ ...seams, focusStyleBox: () => first.current?.focus() }));
    return () => textSeams.set(({ focusStyleBox: _gone, ...rest }) => rest);
  }, []);
  const ctx = shownContext(notebook);
  const all = galleryEntries(ctx);
  const entries = FIRST.flatMap((name) => all.filter((entry) => entry.name === name));
  const current = editor ? styleOfNode(editor.state.selection.$from.parent) : null;
  const apply = (name: string) => {
    const target = targetEditor();
    if (target) applyStyle(target, name, { ...ctx.app, ...ctx.notebook, ...ctx.page });
    target?.commands.focus();
  };
  const describe = (entry: GalleryEntry | null) =>
    entry ? t('textHome.stylesPreview', { name: entry.label, look: lookSummary(entry.look) }) : '';
  return (
    <span className={styles.gallery} role="group" aria-label={t('textHome.stylesGallery')} data-home-gallery="">
      {entries.map((entry, index) => (
        <button
          key={entry.name}
          ref={index === 0 ? first : undefined}
          type="button"
          className={styles.tile}
          style={tileStyle(entry.look)}
          aria-pressed={current === entry.name}
          aria-description={lookSummary(entry.look) || undefined}
          data-style={entry.name}
          onPointerEnter={() => setPreview(entry)}
          onPointerLeave={() => setPreview(null)}
          onFocus={() => setPreview(entry)}
          onBlur={() => setPreview(null)}
          onClick={() => apply(entry.name)}
        >
          {entry.label}
        </button>
      ))}
      <button
        type="button"
        className={styles.tile}
        onClick={() => void executeCommand('styles.pane', undefined, 'commandBar')}
      >
        {t('textHome.stylesMore')}
      </button>
      <VisuallyHidden>
        <span role="status" aria-live="polite" data-style-preview="">
          {describe(preview)}
        </span>
      </VisuallyHidden>
    </span>
  );
}
