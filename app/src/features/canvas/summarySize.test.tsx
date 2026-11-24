// Walk fix VB-102: the JSON Canvas summary is at least 24 px tall.
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test';
import styles from './canvas.module.css';

describe('canvas disclosure', () => {
  it('has a summary at least 24 px tall (VB-102)', () => {
    const view = renderUi(
      <details className={styles.json}>
        <summary>JSON Canvas</summary>
      </details>,
    );
    expect(view.container.querySelector('summary')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
  });
});
