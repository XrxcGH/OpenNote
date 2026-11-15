// The color field of the Format pane (text DESIGN.md 5.3). A box takes a value typed as a pen name, #rrggbb, or
// theme:NAME. A button opens the shared palette: theme colors with tints, standard colors, recent colors, and hex,
// RGB, and HSL fields. A text color that is hard to read on the light or the dark page gets a warning.
import { useId, useState } from 'react';
import { ColorPalette, resolveColor } from '../../../ui/color';
import type { ColorPick, Scheme } from '../../../ui/color';
import { t } from '../../../strings/t';
import { contrastWarning } from '../styles/styleVars';
import styles from './FormatPane.module.css';

/** The page's color scheme, from the resolved theme the root element carries. */
export function currentScheme(): Scheme {
  return document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
}

/** The warning for a color that is hard to read, or null. A color that is not a color gives none. */
export function contrastNote(value: string): string | null {
  const hex = resolveColor(value, 'light');
  if (!hex) return null;
  const warning = contrastWarning(hex);
  if (warning.ok || (warning.light === 0 && warning.dark === 0)) return null;
  if (warning.light < 4.5 && warning.dark < 4.5) return t('textPane.color.contrastBoth');
  return t(warning.light < 4.5 ? 'textPane.color.contrastLight' : 'textPane.color.contrastDark');
}

export interface ColorFieldProps {
  label: string;
  /** The stored value: a pen name, `#rrggbb`, `theme:NAME`, or '' for none. */
  value: string;
  onCommit(value: string): void;
  /** The notebook whose recent colors the palette keeps. */
  notebookId?: string;
  /** A text color is checked for contrast; a fill or an underline color is not. */
  checkContrast?: boolean;
  /** An error from the last commit. */
  error?: string;
}

export function ColorField({ label, value, onCommit, notebookId, checkContrast = false, error }: ColorFieldProps) {
  const id = useId();
  const noteId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const shown = draft ?? value;
  const note = checkContrast ? contrastNote(shown) : null;
  const hex = resolveColor(value, currentScheme());
  return (
    <div className={styles.field} data-field-kind="color">
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.row}>
        <span className={styles.swatch} style={hex ? { background: hex } : undefined} aria-hidden="true" />
        <input
          id={id}
          className={styles.input}
          value={shown}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft !== null && draft !== value) onCommit(draft);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onCommit(shown);
            setDraft(null);
          }}
        />
        <button
          type="button"
          className={styles.small}
          aria-expanded={open}
          aria-label={t('textPane.color.open')}
          onClick={() => setOpen(!open)}
        >
          {t('textPane.color.custom')}
        </button>
      </div>
      {open ? (
        <ColorPalette
          scheme={currentScheme()}
          notebookId={notebookId}
          current={value || null}
          onPick={(pick: ColorPick) => {
            setOpen(false);
            setDraft(null);
            onCommit(pick.kind === 'color' ? pick.value : '');
          }}
        />
      ) : null}
      {note ? (
        <p id={noteId} className={styles.warning} role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.warning}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
