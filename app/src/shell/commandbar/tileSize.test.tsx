// Walk fix VA-19: the style gallery tiles follow the density's target size, not a fixed token.
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test';
import styles from './CommandBar.module.css';

describe('style gallery tile', () => {
  it('stays at the touch size with touch density (VA-19)', () => {
    const view = renderUi(<button className={styles.tile}>Normal text</button>, { density: 'touch' });
    expect(view.container.querySelector('button')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});
