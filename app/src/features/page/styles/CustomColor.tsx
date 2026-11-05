// A custom text color (owner: WP4). The text color picker's "Custom color…" asks for #rrggbb. It shows the
// styles dialog's contrast warning when the color is hard to read on a light or a dark page, and a color that isn't
// one keeps the dialog open with the reason.
import { useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import { contrastWarning } from './styleVars';
import styles from './TextStylesDialog.module.css';

const HEX = /^#[0-9a-f]{6}$/i;
const SHORT_HEX = /^#[0-9a-f]{3}$/i;

/** A color typed as `#rrggbb`, `rrggbb`, `#rgb`, or `rgb`, as lowercase `#rrggbb`; null when it is none of these. */
export function normalizeHex(value: string): string | null {
  const text = value.trim();
  const hashed = text.startsWith('#') ? text : `#${text}`;
  if (HEX.test(hashed)) return hashed.toLowerCase();
  if (SHORT_HEX.test(hashed)) return `#${[...hashed.slice(1)].map((digit) => digit + digit).join('')}`.toLowerCase();
  return null;
}

function CustomColorField({
  value,
  invalid,
  onChange,
}: {
  value: string;
  invalid: boolean;
  onChange(value: string): void;
}) {
  const id = useId();
  const warningId = useId();
  const errorId = useId();
  const color = normalizeHex(value);
  const contrast = color ? contrastWarning(color) : null;
  const theme = contrast && contrast.dark < 4.5 ? 'dark' : 'light';
  const describedBy = invalid ? errorId : contrast && !contrast.ok ? warningId : undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{t('editor.styles.colorHex')}</label>
      <input
        id={id}
        value={value}
        autoFocus
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid ? (
        <p id={errorId} role="alert" className={styles.warning}>
          {t('editor.styles.colorInvalid')}
        </p>
      ) : null}
      {!invalid && contrast && !contrast.ok ? (
        <p id={warningId} className={styles.warning}>
          {t('editor.styles.contrast', { theme })}
        </p>
      ) : null}
    </div>
  );
}

function CustomColorDialog({ initial, finish }: { initial: string; finish(answer: string | null): void }) {
  const [current, setCurrent] = useState(initial);
  const [tried, setTried] = useState(false);
  const invalid = tried && normalizeHex(current) === null;
  return (
    <Dialog
      title={t('editor.colorMenu.label')}
      size="small"
      onDismiss={() => finish(null)}
      actions={[
        {
          id: 'cancel',
          label: t('common.cancel'),
          variant: 'secondary',
          leastDestructive: true,
          onPress: () => finish(null),
        },
        {
          id: 'ok',
          label: t('editor.colorMenu.apply'),
          variant: 'primary',
          onPress: () => {
            const color = normalizeHex(current);
            if (color) finish(color);
            else setTried(true);
          },
        },
      ]}
    >
      <CustomColorField
        value={current}
        invalid={invalid}
        onChange={(value) => {
          setCurrent(value);
          setTried(false);
        }}
      />
    </Dialog>
  );
}

/** Asks for a custom color. Resolves to #rrggbb, or null when canceled. */
export function chooseCustomColor(initial = '#'): Promise<string | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const finish = (answer: string | null) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(answer);
    };
    root.render(<CustomColorDialog initial={initial} finish={finish} />);
  });
}
