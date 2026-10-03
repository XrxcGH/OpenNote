// The Text styles dialog (ARCHITECTURE.md section 17.3; owner: WP4): each style's font, size, weight, color,
// spacing, and line height, with live previews on a light and a dark page. A custom color below 4.5:1 on either
// page shows a warning next to its field. Every field is labeled, and "Reset to default" clears a style.
import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { tokens } from '../../../theme/tokens';
import { Button, Dialog, showToast } from '../../../ui';
import { contrastWarning, STYLE_FONTS, STYLE_LIMITS, STYLE_NAMES, withStyle } from './styleVars';
import type { NotebookStyles, StyleName, StyleValues } from './styleVars';
import { saveStyles, shownNotebook, stylesFor } from './store';
import styles from './TextStylesDialog.module.css';

const PENS = tokens.ink.pens.map((pen) => pen.name.toLowerCase());
const WEIGHTS = [400, 500, 600, 700];
const CLEARED: StyleValues = {
  font: undefined,
  size: undefined,
  weight: undefined,
  color: undefined,
  spaceBefore: undefined,
  spaceAfter: undefined,
  lineHeight: undefined,
};

function NumberField(props: {
  label: string;
  value: number | undefined;
  limits: readonly [number, number];
  step?: number;
  onChange(value: number | undefined): void;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="number"
        min={props.limits[0]}
        max={props.limits[1]}
        step={props.step ?? 1}
        value={props.value ?? ''}
        placeholder={t('editor.styles.defaultColor')}
        onChange={(event) => props.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    </div>
  );
}

function ChoiceField(props: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The color field: a pen, Default, or a custom #rrggbb with its contrast warning. */
function ColorField({ value, onChange }: { value: string | undefined; onChange(value: string | undefined): void }) {
  const hexId = useId();
  const warningId = useId();
  const custom = value !== undefined && !PENS.includes(value);
  const contrast = custom && /^#[0-9a-f]{6}$/i.test(value) ? contrastWarning(value) : null;
  const theme = contrast && contrast.dark < 4.5 ? 'dark' : 'light';
  return (
    <>
      <ChoiceField
        label={t('editor.styles.color')}
        value={value === undefined ? '' : custom ? 'custom' : value}
        options={[
          { value: '', label: t('editor.styles.defaultColor') },
          ...PENS.map((pen) => ({ value: pen, label: t(`commands.colors.${pen}` as MessageKey) })),
          { value: 'custom', label: t('editor.colorMenu.custom') },
        ]}
        onChange={(next) => onChange(next === '' ? undefined : next === 'custom' ? '#' : next)}
      />
      {custom ? (
        <div className={styles.field}>
          <label htmlFor={hexId}>{t('editor.styles.colorHex')}</label>
          <input
            id={hexId}
            value={value}
            aria-describedby={contrast && !contrast.ok ? warningId : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          {contrast && !contrast.ok ? (
            <p id={warningId} className={styles.warning}>
              {t('editor.styles.contrast', { theme })}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** How a style looks with its values, on one theme's page. */
function previewStyle(values: StyleValues, theme: 'light' | 'dark'): CSSProperties {
  const pen = tokens.ink.pens.find((candidate) => candidate.name.toLowerCase() === values.color);
  const ink = tokens.ink.pens[0][theme];
  return {
    fontFamily: values.font ? `"${values.font}"` : undefined,
    fontSize: values.size ? `${values.size}px` : undefined,
    fontWeight: values.weight,
    lineHeight: values.lineHeight,
    color: pen ? pen[theme] : (values.color ?? ink),
    background: tokens.color[theme].surface.page,
  };
}

function Preview({ values, theme }: { values: StyleValues; theme: 'light' | 'dark' }) {
  return (
    <figure className={styles.preview} style={previewStyle(values, theme)}>
      <figcaption className={styles.caption}>
        {t(theme === 'light' ? 'editor.styles.previewLight' : 'editor.styles.previewDark')}
      </figcaption>
      <p>{t('editor.styles.preview')}</p>
    </figure>
  );
}

/** The fields of one style. */
function StyleFields({ values, update }: { values: StyleValues; update(patch: Partial<StyleValues>): void }) {
  return (
    <>
      <ChoiceField
        label={t('editor.styles.font')}
        value={values.font ?? ''}
        options={[
          { value: '', label: t('editor.styles.defaultColor') },
          ...STYLE_FONTS.map((font) => ({ value: font, label: font })),
        ]}
        onChange={(font) => update({ font: (font || undefined) as StyleValues['font'] })}
      />
      <NumberField
        label={t('editor.styles.size')}
        value={values.size}
        limits={STYLE_LIMITS.size}
        onChange={(size) => update({ size })}
      />
      <ChoiceField
        label={t('editor.styles.weight')}
        value={values.weight ? String(values.weight) : ''}
        options={[
          { value: '', label: t('editor.styles.defaultColor') },
          ...WEIGHTS.map((weight) => ({ value: String(weight), label: String(weight) })),
        ]}
        onChange={(weight) => update({ weight: weight ? Number(weight) : undefined })}
      />
      <ColorField value={values.color} onChange={(color) => update({ color })} />
      <NumberField
        label={t('editor.styles.spaceBefore')}
        value={values.spaceBefore}
        limits={STYLE_LIMITS.spaceBefore}
        onChange={(spaceBefore) => update({ spaceBefore })}
      />
      <NumberField
        label={t('editor.styles.spaceAfter')}
        value={values.spaceAfter}
        limits={STYLE_LIMITS.spaceAfter}
        onChange={(spaceAfter) => update({ spaceAfter })}
      />
      <NumberField
        label={t('editor.styles.lineHeight')}
        value={values.lineHeight}
        limits={STYLE_LIMITS.lineHeight}
        step={0.1}
        onChange={(lineHeight) => update({ lineHeight })}
      />
    </>
  );
}

export function StyleEditor({ initial, onChange }: { initial: NotebookStyles; onChange(next: NotebookStyles): void }) {
  const [all, setAll] = useState<NotebookStyles>(initial);
  const [style, setStyle] = useState<StyleName>('normal');
  const values = all[style] ?? {};
  const update = (patch: Partial<StyleValues>) => {
    const next = withStyle(all, style, { ...values, ...patch });
    setAll(next);
    onChange(next);
  };
  const name = (key: StyleName) => t(`editor.styles.names.${key}`);
  return (
    <div className={styles.editor}>
      <ChoiceField
        label={t('editor.styles.list')}
        value={style}
        options={STYLE_NAMES.map((key) => ({ value: key, label: name(key) }))}
        onChange={(next) => setStyle(next as StyleName)}
      />
      <StyleFields values={values} update={update} />
      <div className={styles.previews}>
        <Preview values={values} theme="light" />
        <Preview values={values} theme="dark" />
      </div>
      <div className={styles.actions}>
        <Button onClick={() => update(CLEARED)}>{t('editor.styles.reset')}</Button>
        <Button
          variant="quiet"
          onClick={() => {
            setAll({});
            onChange({});
          }}
        >
          {t('editor.styles.resetAll')}
        </Button>
      </div>
    </div>
  );
}

/** Opens the dialog for a notebook, by default the shown page's. Saving swaps the style variables; nothing re-renders. */
export function openTextStyles(notebookId?: string): Promise<void> {
  const notebook = notebookId ?? shownNotebook();
  if (!notebook) {
    showToast({ message: t('editor.styles.noNotebook') });
    return Promise.resolve();
  }
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let draft = stylesFor(notebook);
  return new Promise((resolve) => {
    const close = () => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        resolve();
      });
    };
    const save = () => {
      const saved = saveStyles(notebook, draft);
      showToast({
        message: t(saved ? 'editor.styles.saved' : 'editor.styles.saveFailed'),
        tone: saved ? undefined : 'danger',
      });
      close();
    };
    root.render(
      <Dialog
        title={t('editor.styles.title')}
        size="medium"
        onDismiss={close}
        actions={[
          { id: 'cancel', label: t('common.cancel'), variant: 'secondary', leastDestructive: true, onPress: close },
          { id: 'save', label: t('editor.styles.save'), variant: 'primary', onPress: save },
        ]}
      >
        <StyleEditor initial={draft} onChange={(next) => (draft = next)} />
      </Dialog>,
    );
  });
}
