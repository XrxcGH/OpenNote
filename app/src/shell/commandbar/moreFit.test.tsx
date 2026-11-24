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

  it('wraps a long item instead of running past the list (R-VA-31)', () => {
    const view = renderUi(
      <div style={{ inlineSize: '180px' }}>
        <ul className={styles.moreList}>
          <li>
            <button type="button" className={styles.moreItem}>
              2026-11-23UntitledpageUntitledpageUntitledpage
            </button>
          </li>
        </ul>
      </div>,
    );
    const list = view.container.querySelector('ul')!;
    const item = view.container.querySelector('button')!;
    expect(item.getBoundingClientRect().right).toBeLessThanOrEqual(list.getBoundingClientRect().right + 1);
  });
});
