// A menu item in a narrow menu keeps its label readable beside a long shortcut (walk 9, T2-D02-2).
import { describe, expect, it } from 'vitest';
import { renderUi } from '../test';
import styles from './Menu.module.css';

describe('a menu item in a narrow menu', () => {
  it('wraps the shortcut under the label and does not crush it (T2-D02-2)', () => {
    const view = renderUi(
      <div style={{ inlineSize: '200px' }}>
        <div className={styles.item}>
          <span className={styles.label}>Insert code cell</span>
          <span className={styles.shortcut}>Ctrl+Alt+Shift+K</span>
        </div>
      </div>,
    );
    const label = view.container.querySelector<HTMLElement>(`.${styles.label}`)!;
    const line = parseFloat(getComputedStyle(label).lineHeight);
    expect(label.getBoundingClientRect().height).toBeLessThanOrEqual(2 * line + 1);
  });
});
