// Text that screen readers read but the screen doesn't show, such as a description that explains a control's
// extra ways to use it. Prefer visible text; use this only when the visible design already says the same thing.

import type { ReactNode } from 'react';
import styles from './VisuallyHidden.module.css';

/** The class that hides an element visually, for elements that can't be wrapped. */
export const visuallyHiddenClass = styles.hidden;

export function VisuallyHidden({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className={styles.hidden}>
      {children}
    </span>
  );
}
