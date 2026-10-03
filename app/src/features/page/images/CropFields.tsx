// The crop fields of "Size and position" (Phase 4 ARCHITECTURE.md section 12.4): how much is cut from each side,
// in percent, and "Reset crop", so cropping works from the keyboard. WP3's popover shows them for an image, and
// each change is one undo step through applyCrop.
import { useId, useState } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import type { Crop, CropInsets } from './geometry';
import { cropToInsets, insetsToCrop } from './geometry';
import styles from './dialog.module.css';

export interface CropFieldsProps {
  crop: Crop | null;
  onChange(crop: Crop | null): void;
}

const SIDES = ['left', 'top', 'right', 'bottom'] as const;

export function CropFields({ crop, onChange }: CropFieldsProps) {
  const id = useId();
  const [insets, setInsets] = useState<CropInsets>(() => cropToInsets(crop));
  // A crop changed elsewhere (undo, crop mode) resets the fields.
  const [shown, setShown] = useState(crop);
  if (shown !== crop) {
    setShown(crop);
    setInsets(cropToInsets(crop));
  }
  const commit = (next: CropInsets) => {
    const nextCrop = insetsToCrop(next);
    setInsets(cropToInsets(nextCrop));
    if (JSON.stringify(nextCrop) !== JSON.stringify(crop)) onChange(nextCrop);
  };
  return (
    <fieldset className={styles.fields}>
      <legend>{t('images.cropFields.legend')}</legend>
      {SIDES.map((side) => (
        <div key={side} className={styles.number}>
          <label htmlFor={`${id}-${side}`}>{t(`images.cropFields.${side}`)}</label>
          <input
            id={`${id}-${side}`}
            type="number"
            min={0}
            max={98}
            step={1}
            inputMode="decimal"
            aria-description={t('images.cropFields.unit')}
            value={insets[side]}
            onChange={(event) => setInsets({ ...insets, [side]: Number(event.target.value) })}
            onBlur={() => commit(insets)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit(insets);
            }}
          />
        </div>
      ))}
      <div className={styles.reset}>
        <Button variant="secondary" disabled={crop === null} onClick={() => commit(cropToInsets(null))}>
          {t('images.cropFields.reset')}
        </Button>
      </div>
    </fieldset>
  );
}
