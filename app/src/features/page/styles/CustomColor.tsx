// A custom text color (owner: WP4). The text color picker's "Custom color…" asks for #rrggbb. It shows the
// styles dialog's contrast warning when the color is hard to read on a light or a dark page.
import { useEffect, useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import { contrastWarning } from './styleVars';
import styles from './TextStylesDialog.module.css';

const HEX = /^#[0-9a-f]{6}$/i;

function CustomColorField({ value, onChange }: { value: string; onChange(value: string): void }) {
  const id = useId();
  const warningId = useId();
  const contrast = HEX.test(value) ? contrastWarning(value) : null;
  const theme = contrast && contrast.dark < 4.5 ? 'dark' : 'light';
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{t('editor.styles.colorHex')}</label>
      <input
        id={id}
        value={value}
        autoFocus
        aria-describedby={contrast && !contrast.ok ? warningId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {contrast && !contrast.ok ? (
        <p id={warningId} className={styles.warning}>
          {t('editor.styles.contrast', { theme })}
        </p>
      ) : null}
    </div>
  );
}

/** Asks for a custom color. Resolves to #rrggbb, or null when canceled. */
export function chooseCustomColor(initial = '#'): Promise<string | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const chosen = { value: initial };
    const finish = (answer: string | null) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(answer);
    };
    function Body() {
      const [current, setCurrent] = useState(initial);
      useEffect(() => {
        chosen.value = current;
      }, [current]);
      return <CustomColorField value={current} onChange={setCurrent} />;
    }
    root.render(
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
            onPress: () => finish(HEX.test(chosen.value) ? chosen.value.toLowerCase() : null),
          },
        ]}
      >
        <Body />
      </Dialog>,
    );
  });
}
