// Walk fix VA-22: the read-aloud selects follow the density's target size, not the 24 px minimum.
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import styles from './readAloud.module.css';

describe('read-aloud select', () => {
  it('stays at the touch size with touch density (VA-22)', () => {
    const view = renderUi(<select className={styles.select} aria-label="Speed" />, { density: 'touch' });
    expect(view.container.querySelector('select')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});
