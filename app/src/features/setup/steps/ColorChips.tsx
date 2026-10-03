// The color chips of a new notebook: a radio group with one chip for each pen color, each named. Chips show the
// pen's color for the current theme, keep it under a Windows contrast theme, and get a ring so they stay visible.

import type { ChipColor } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { RadioCard, RadioGroup } from '../../../ui';
import styles from '../SetupView.module.css';

interface ColorChipsProps {
  label: string;
  colors: readonly ChipColor[];
  value: ChipColor;
  onChange(color: ChipColor): void;
}

export function ColorChips({ label, colors, value, onChange }: ColorChipsProps) {
  return (
    <RadioGroup label={label} value={value} onChange={onChange}>
      {colors.map((color) => (
        <RadioCard
          key={color}
          value={color}
          label={t(`setup.storage.notebook.colors.${color}` as MessageKey)}
          preview={<span className={styles.chip} style={{ background: `var(--ink-${color})` }} />}
        />
      ))}
    </RadioGroup>
  );
}
