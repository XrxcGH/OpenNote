// Walk fix VA-38: the page only makes room for the linked pages sheet when the window has room for both.
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../test';
import styles from './Workspace.module.css';

afterEach(() => {
  delete document.body.dataset.linkedPages;
  document.documentElement.style.fontSize = '';
});

const reserved = () => {
  document.body.dataset.linkedPages = '';
  const view = renderUi(<div className={styles.page} />);
  return parseFloat(getComputedStyle(view.container.querySelector('div')!).marginInlineEnd);
};

describe('room for the linked pages sheet', () => {
  it('reserves the sheet width in a roomy window', () => {
    expect(reserved()).toBeGreaterThan(300);
  });

  it('reserves nothing when large text leaves the window too narrow for both (VA-38)', () => {
    document.documentElement.style.fontSize = '40px';
    expect(reserved()).toBe(0);
  });
});
