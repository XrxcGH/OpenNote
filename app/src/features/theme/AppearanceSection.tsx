// The Appearance section of Settings (ARCHITECTURE.md section 16.1): the theme cards, page color in dark mode,
// text size, interface size, reduce motion, and the size of buttons and rows. Every change applies at once and
// goes to Rust as a settings patch; the section holds no state of its own.

import { useId } from 'react';
import type { Settings, SettingsPatch, TextSize } from '../../platform/types';
import { useSettings, updateSettings } from '../../state/settings';
import { t } from '../../strings/t';
import { setThemePreference } from '../../theme/theme';
import { UI_SCALES } from '../../theme/appearance';
import { RadioCard, RadioGroup } from '../../ui';
import styles from './AppearanceSection.module.css';
import { ThemeCards } from './ThemeCards';
import { TEXT_SIZES, setTextSize } from './zoom';

type Appearance = Settings['appearance'];

interface ChoiceProps {
  label: string;
  help?: string;
  value: string;
  options: readonly { value: string; label: string }[];
  /** Gives every option one width, for a row of equal steps such as percentages. */
  even?: boolean;
  onChange(value: string): void;
}

/** A labeled group of choices. Every option is a card in a radio group, so arrow keys move the selection. */
function Choice({ label, help, value, options, even, onChange }: ChoiceProps) {
  const id = useId();
  return (
    <section className={even ? `${styles.group} ${styles.even}` : styles.group} aria-labelledby={`${id}-label`}>
      <h2 id={`${id}-label`} className={styles.label}>
        {label}
      </h2>
      {help && <p className={styles.help}>{help}</p>}
      <RadioGroup label={label} value={value} onChange={onChange}>
        {options.map((option) => (
          <RadioCard key={option.value} value={option.value} label={option.label} />
        ))}
      </RadioGroup>
    </section>
  );
}

const save = (appearance: SettingsPatch['appearance']) => void updateSettings({ appearance }).catch(() => {});

const percent = (size: number) => t('theme.appearance.textSize.option', { size });

function ThemeGroup() {
  const id = useId();
  const theme = useSettings((settings) => settings.appearance.theme);
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h2 id={id} className={styles.label}>
        {t('theme.appearance.theme')}
      </h2>
      <ThemeCards value={theme} onChange={(choice) => setThemePreference(choice, 'settings')} />
    </section>
  );
}

function SizeGroups({ appearance }: { appearance: Appearance }) {
  return (
    <>
      <Choice
        label={t('theme.appearance.textSize.label')}
        help={t('theme.appearance.textSize.help')}
        value={String(appearance.textSize)}
        options={TEXT_SIZES.map((size) => ({ value: String(size), label: percent(size) }))}
        even
        onChange={(size) => setTextSize(Number(size) as TextSize)}
      />
      <Choice
        label={t('theme.appearance.interfaceSize.label')}
        help={t('theme.appearance.interfaceSize.help')}
        value={String(appearance.uiScale)}
        options={UI_SCALES.map((scale) => ({ value: String(scale), label: percent(scale) }))}
        even
        onChange={(scale) => save({ uiScale: Number(scale) })}
      />
    </>
  );
}

function ComfortGroups({ appearance }: { appearance: Appearance }) {
  return (
    <>
      <Choice
        label={t('theme.appearance.motion.label')}
        value={appearance.motion}
        options={[
          { value: 'system', label: t('theme.appearance.motion.system') },
          { value: 'reduce', label: t('theme.appearance.motion.reduce') },
        ]}
        onChange={(motion) => save({ motion: motion as Appearance['motion'] })}
      />
      <Choice
        label={t('theme.appearance.density.label')}
        help={t('theme.appearance.density.help')}
        value={appearance.density}
        options={[
          { value: 'auto', label: t('theme.appearance.density.auto') },
          { value: 'mouse', label: t('theme.appearance.density.mouse') },
          { value: 'touch', label: t('theme.appearance.density.touch') },
        ]}
        onChange={(density) => save({ density: density as Appearance['density'] })}
      />
    </>
  );
}

export default function AppearanceSection() {
  const appearance = useSettings((settings): Appearance => settings.appearance);
  return (
    <div className={styles.section}>
      <ThemeGroup />
      <Choice
        label={t('theme.appearance.pageColor.label')}
        value={appearance.pageColor}
        options={[
          { value: 'matchTheme', label: t('theme.appearance.pageColor.matchTheme') },
          { value: 'paper', label: t('theme.appearance.pageColor.paper') },
        ]}
        onChange={(pageColor) => save({ pageColor: pageColor as Appearance['pageColor'] })}
      />
      <SizeGroups appearance={appearance} />
      <ComfortGroups appearance={appearance} />
    </div>
  );
}
