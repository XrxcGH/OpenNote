// The root of every drawing. It is hidden from screen readers, because an empty state's meaning stays in its text,
// and it can't take focus. The box is the drawing's own coordinate space; width and height are the drawn size, so a
// drawing can be shown smaller than it was drawn.

import type { ReactNode } from 'react';
import styles from './illustrations.module.css';

export interface ArtProps {
  /** Adds a class for the place, such as a corner that hides the drawing when it is too narrow. */
  className?: string;
}

interface FrameProps extends ArtProps {
  width: number;
  height: number;
  /** The drawing's own size, when it differs from the drawn size. */
  box?: readonly [number, number];
  children: ReactNode;
}

export function Art({ width, height, box = [width, height], className, children }: FrameProps) {
  return (
    <svg
      className={className ? `${styles.art} ${className}` : styles.art}
      viewBox={`0 0 ${box[0]} ${box[1]}`}
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
