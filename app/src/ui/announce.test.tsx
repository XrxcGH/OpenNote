import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test';
import { Announcer, announce, announcements, clearAnnouncements, recordAnnouncement } from './announce';

const region = (politeness: 'polite' | 'assertive') =>
  document.querySelector(`[aria-live="${politeness}"]`) as HTMLElement;

describe('Announcer', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it('owns one polite and one assertive live region, both empty until something is announced', () => {
    render(<Announcer />);
    expect(region('polite').textContent).toBe('');
    expect(region('assertive').textContent).toBe('');
    expect(region('polite').getAttribute('aria-atomic')).toBe('true');
  });

  it('puts polite and assertive announcements in their own regions', () => {
    render(<Announcer />);
    act(() => {
      announce('Notebooks pane hidden.');
      announce('Couldn’t save the page.', 'assertive');
    });
    expect(region('polite').textContent).toBe('Notebooks pane hidden.');
    expect(region('assertive').textContent).toBe('Couldn’t save the page.');
    expect(announcements()).toEqual(['Notebooks pane hidden.', 'Couldn’t save the page.']);
  });

  it('drops the same text within 500 ms and announces it again after', () => {
    render(<Announcer />);
    act(() => announce('Update ready.'));
    const first = region('polite').firstElementChild;
    vi.setSystemTime(Date.now() + 499);
    act(() => announce('Update ready.'));
    expect(announcements()).toEqual(['Update ready.']);
    expect(region('polite').firstElementChild).toBe(first);
    vi.setSystemTime(Date.now() + 2);
    act(() => announce('Update ready.'));
    expect(announcements()).toEqual(['Update ready.', 'Update ready.']);
    // A new element, so a screen reader reads text that didn't change.
    expect(region('polite').firstElementChild).not.toBe(first);
  });

  it('announces different text at once', () => {
    render(<Announcer />);
    act(() => {
      announce('Light theme.');
      announce('Dark theme.');
    });
    expect(announcements()).toEqual(['Light theme.', 'Dark theme.']);
    expect(region('polite').textContent).toBe('Dark theme.');
  });

  it('ignores empty text', () => {
    render(<Announcer />);
    act(() => announce(''));
    expect(announcements()).toEqual([]);
  });

  it('logs what a status region already says without a second live region', () => {
    render(<Announcer />);
    recordAnnouncement('Moved 1 page to Final.');
    expect(announcements()).toEqual(['Moved 1 page to Final.']);
    expect(region('polite').textContent).toBe('');
  });

  it('clears the log and the regions', () => {
    render(<Announcer />);
    act(() => announce('Dark theme.'));
    act(() => clearAnnouncements());
    expect(announcements()).toEqual([]);
    expect(region('polite').textContent).toBe('');
  });

  it('stays usable while everything else is inert, and passes axe', async () => {
    const { container } = render(<Announcer />);
    expect(container.querySelector('[data-modal-exempt]')).toBeTruthy();
    act(() => announce('Dark theme.'));
    await expectNoAxeViolations(document.body);
  });
});
