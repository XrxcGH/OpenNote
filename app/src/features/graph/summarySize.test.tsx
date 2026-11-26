// Walk fix VB-102: the unlinked pages summary is at least 24 px tall.
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test';
import styles from './graph.module.css';

describe('graph disclosure', () => {
  it('has a summary at least 24 px tall (VB-102)', () => {
    const view = renderUi(
      <details className={styles.unlinked}>
        <summary>Pages with no links, 1</summary>
      </details>,
    );
    expect(view.container.querySelector('summary')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
  });
});
