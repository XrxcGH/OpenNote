// The notices above a page that can't open or can't save, with the real CSS (walk 10: T2-D04-7, T2-D04-9).

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenFailedNotice } from './openFailedNotice';

afterEach(cleanup);

/** The notice's text and buttons sit inside the pane, away from its edge, and a button looks like one. */
function expectPadded(notice: HTMLElement, button: HTMLElement): void {
  const box = getComputedStyle(notice);
  expect(Number.parseFloat(box.paddingLeft) + Number.parseFloat(box.marginLeft)).toBeGreaterThanOrEqual(12);
  expect(Number.parseFloat(getComputedStyle(button).paddingLeft)).toBeGreaterThanOrEqual(8);
}

describe('the notice of a page that cannot open', () => {
  it('is padded, and its put-back button looks like a button', () => {
    render(<OpenFailedNotice failure="damaged" onRecover={() => {}} note={null} />);
    const notice = screen.getByRole('alert');
    expectPadded(notice, screen.getByRole('button', { name: 'Put back the last saved version' }));
  });

  it('has no button for another failure', () => {
    render(<OpenFailedNotice failure="other" onRecover={undefined} note={null} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
