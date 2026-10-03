// The three theme cards (ARCHITECTURE.md sections 9.3 and 17.4): Light, Dark, and Match Windows as a radio group
// named "Theme". Settings and setup both use them. Each card holds a small live preview of the app, drawn with the
// scoped theme blocks, that screen readers and Tab never enter. Holding an arrow key moves one step, so the theme
// can't flash. Under a Windows contrast theme a note says the choice applies when the contrast theme is off.

import type { ThemePreference } from '../../platform/types';
import { useOs } from '../../state/os';
import { t } from '../../strings/t';
import { Glint, RadioCard, RadioGroup } from '../../ui';
import styles from './ThemeCards.module.css';

const CHOICES = [
  { value: 'light', label: 'theme.choices.light', caption: 'theme.captions.light' },
  { value: 'dark', label: 'theme.choices.dark', caption: 'theme.captions.dark' },
  { value: 'system', label: 'theme.choices.system', caption: 'theme.captions.system' },
] as const;

export interface ThemeCardsProps {
  value: ThemePreference;
  onChange(value: ThemePreference): void;
  /** Replaces the Match Windows caption, such as "Preselected because Windows is set to Light." */
  systemCaption?: string;
}

/**
 * A small app window in one theme: a title bar, a sidebar, and a page with lines of text, and in the corner a low
 * sun for Light or a moon and stars for Dark. In Match Windows each half keeps its own mark at its own edge.
 */
function Mini({ theme, corner = 'end' }: { theme: 'light' | 'dark'; corner?: 'start' | 'end' }) {
  return (
    <span data-theme-scope={theme} className={styles.mini}>
      <Glint
        kind={theme === 'light' ? 'sun' : 'moon'}
        className={corner === 'end' ? styles.glintEnd : styles.glintStart}
      />
      <span className={styles.bar} />
      <span className={styles.body}>
        <span className={styles.side}>
          <span className={styles.selected} />
          <span className={styles.line} />
          <span className={styles.line} />
        </span>
        <span className={styles.page}>
          <span className={styles.heading} />
          <span className={styles.line} />
          <span className={styles.line} />
          <span className={styles.short} />
        </span>
      </span>
    </span>
  );
}

function Preview({ choice }: { choice: ThemePreference }) {
  if (choice !== 'system') return <Mini theme={choice} />;
  return (
    <span className={styles.split}>
      <Mini theme="light" corner="start" />
      <Mini theme="dark" />
    </span>
  );
}

export function ThemeCards({ value, onChange, systemCaption }: ThemeCardsProps) {
  const contrast = useOs((os) => os.contrast);
  return (
    <div className={styles.cards}>
      <RadioGroup label={t('theme.appearance.theme')} value={value} onChange={onChange} ignoreRepeat>
        {CHOICES.map((choice) => (
          <RadioCard
            key={choice.value}
            value={choice.value}
            label={t(choice.label)}
            description={choice.value === 'system' && systemCaption ? systemCaption : t(choice.caption)}
            preview={<Preview choice={choice.value} />}
          />
        ))}
      </RadioGroup>
      {contrast && <p className={styles.note}>{t('theme.contrastNoteLater')}</p>}
    </div>
  );
}
