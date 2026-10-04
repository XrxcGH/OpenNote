// A lit candle in a clay dish, 28 x 58. The flame is the one place the candle color shows; the warm glow around it
// is a flat radial gradient in the candle tint that fades to nothing. The flame never flickers.

import { useId } from 'react';
import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';
import { CANDLE } from './shapes';

export function CandleArt() {
  const glow = useId();
  return (
    <>
      <defs>
        <radialGradient id={glow} className={styles.glow}>
          <stop offset="0" />
          <stop offset="0.45" stopOpacity="0.6" />
          <stop offset="1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className={styles.halo} {...CANDLE.halo} fill={`url(#${glow})`} />
      <path className={styles.sun} d={CANDLE.flame} />
      <path d={CANDLE.wick} />
      <path d={CANDLE.body} />
      <path d={CANDLE.shine} />
      <path className={styles.fillClay} d={CANDLE.dish} />
      <path d={CANDLE.base} />
    </>
  );
}

export function Candle({ className }: ArtProps) {
  return (
    <Art width={CANDLE.box[0]} height={CANDLE.box[1]} className={className}>
      <CandleArt />
    </Art>
  );
}
