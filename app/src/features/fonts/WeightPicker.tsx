// The weights a family has, as Docs' font weights menu lists them: only the faces the shell found.
import { t } from '../../strings/t';
import type { FontFamily } from '../../platform/types';
import styles from './fonts.module.css';
import { weightsOf } from './weights';

export interface WeightPickerProps {
  family: FontFamily | undefined;
  /** The weight now, or null for a mixed selection. */
  weight: number | null;
  onPick(weight: number): void;
}

export function WeightPicker({ family, weight, onPick }: WeightPickerProps) {
  const choices = family === undefined ? [] : weightsOf(family);
  return (
    <select
      className={styles.weight}
      aria-label={t('textFonts.weightLabel')}
      disabled={choices.length < 2}
      value={weight === null ? '' : String(weight)}
      onChange={(event) => onPick(Number(event.target.value))}
    >
      {weight === null || !choices.some((one) => one.weight === weight) ? <option value="" /> : null}
      {choices.map((choice) => (
        <option key={choice.weight} value={choice.weight}>
          {t(choice.key)}
        </option>
      ))}
    </select>
  );
}
