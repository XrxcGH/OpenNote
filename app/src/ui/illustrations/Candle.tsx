// A lit candle in a dish, 28 x 58. The flame is the one place the candle color shows; the glow around it is a flat
// radial gradient in the candle tint. The flame never flickers.

import { useId } from 'react';
import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';

export function CandleArt() {
  const glow = useId();
  return (
    <>
      <defs>
        <radialGradient id={glow} className={styles.glow}>
          <stop offset="0" />
          <stop offset="1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="14" cy="13" r="17" fill={`url(#${glow})`} stroke="none" />
      <path className={styles.sun} d="M14 4.6C17.8 9.6 18.2 14.6 14.2 17.8 10.2 14.8 10.4 9.8 14 4.6Z" />
      <path d="M14 18.4V22" />
      <path d="M9 22.6C12 21.8 16 22 19 22.5L19.2 54.2C16 54.9 12 54.8 8.8 54.1Z" />
      <path d="M16.2 22.8C16.4 26.4 16 28.2 14.8 28.6" />
      <path d="M3 51C8 56.2 20 56.4 25 51.2" />
      <path d="M8 56H20" />
    </>
  );
}

export function Candle({ className }: ArtProps) {
  return (
    <Art width={28} height={58} className={className}>
      <CandleArt />
    </Art>
  );
}
