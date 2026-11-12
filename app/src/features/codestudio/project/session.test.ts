// @vitest-environment jsdom
// A project's session state stays on this device, keyed by block ID, and never in the page.
import { beforeEach, describe, expect, it } from 'vitest';
import { CONSOLE_HISTORY, EMPTY_SESSION, clearSession, loadSession, rememberCommand, updateSession } from './session';

describe('project session', () => {
  beforeEach(() => localStorage.clear());

  it('keeps breakpoints, watches, tabs, scroll, and console history per block', () => {
    updateSession('b1', { breakpoints: { f01: [7, 3, 3] }, watches: ['nums'], openTabs: ['f01', 'f02'] });
    updateSession('b1', { activeTab: 'f02', scroll: { f02: { top: 120, left: 0 } } });
    rememberCommand('b1', 'print(nums)');
    expect(loadSession('b1')).toEqual({
      breakpoints: { f01: [3, 7] },
      watches: ['nums'],
      openTabs: ['f01', 'f02'],
      activeTab: 'f02',
      scroll: { f02: { top: 120, left: 0 } },
      console: ['print(nums)'],
    });
    expect(loadSession('b2')).toEqual(EMPTY_SESSION);
  });

  it('removes a key with null, and clears a block', () => {
    updateSession('b1', { breakpoints: { f01: [1], f02: [2] } });
    updateSession('b1', { breakpoints: { f01: null } });
    expect(loadSession('b1').breakpoints).toEqual({ f02: [2] });
    clearSession('b1');
    expect(loadSession('b1')).toEqual(EMPTY_SESSION);
  });

  it('keeps the newest console commands up to the cap', () => {
    for (let i = 0; i < CONSOLE_HISTORY + 5; i++) rememberCommand('b1', `c${i}`);
    const { console: history } = loadSession('b1');
    expect(history).toHaveLength(CONSOLE_HISTORY);
    expect(history.at(-1)).toBe(`c${CONSOLE_HISTORY + 4}`);
  });

  it('starts fresh from damaged storage', () => {
    localStorage.setItem('opennote.codestudio.session.b1', '{not json');
    expect(loadSession('b1')).toEqual(EMPTY_SESSION);
    localStorage.setItem('opennote.codestudio.session.b1', JSON.stringify({ breakpoints: { f01: ['x', -1, 2] } }));
    expect(loadSession('b1').breakpoints).toEqual({ f01: [2] });
  });
});
