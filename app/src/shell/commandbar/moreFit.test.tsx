// Walk fix VA-31: the bottom bar More list never grows wider than the window.
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test';
import styles from './CommandBar.module.css';

describe('the bottom bar More list', () => {
  it('stays inside the window even when its minimum width is large (VA-31)', () => {
    const view = renderUi(
      <ul className={styles.moreList} style={{ '--size-menu-min-width': '5000px' } as React.CSSProperties}>
        <li>Recent pages</li>
      </ul>,
    );
    const list = view.container.querySelector('ul')!;
    expect(list.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth);
  });
});
