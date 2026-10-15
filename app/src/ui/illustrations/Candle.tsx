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

/**
 * The glow reaches past the candle's own box on three sides (above the flame and on its left and right), so the
 * candle on its own gets a margin as wide as the glow overhangs. Without it the glow would end in a hard edge at the top and sides.
 */
const GLOW_X = CANDLE.halo.r - CANDLE.halo.cx;
const GLOW_Y = CANDLE.halo.r - CANDLE.halo.cy;

export function Candle({ className }: ArtProps) {
  const [width, height] = [CANDLE.box[0] + 2 * GLOW_X, CANDLE.box[1] + GLOW_Y];
  return (
    <Art width={width} height={height} className={className}>
      <g transform={`translate(${GLOW_X} ${GLOW_Y})`}>
        <CandleArt />
      </g>
    </Art>
  );
}
