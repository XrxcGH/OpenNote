// @vitest-environment jsdom
// Which window a script runs in decides whether app-wide work (tab tracking, rename plans) starts there.
import { afterEach, describe, expect, it } from 'vitest';
import { isMainWindow, windowKind } from './windowKind';

type Scope = { __OPENNOTE_WINDOW__?: { kind?: string }; __OPENNOTE_TOOL__?: string };
const scope = window as unknown as Scope;

afterEach(() => {
  delete scope.__OPENNOTE_WINDOW__;
  delete scope.__OPENNOTE_TOOL__;
  window.history.replaceState(null, '', '/');
});

describe('the window kind', () => {
  it('is the main window when the shell names nothing', () => {
    expect(windowKind()).toBe('main');
    expect(isMainWindow()).toBe(true);
  });

  it('is a tool window for the tool global or the tool query', () => {
    scope.__OPENNOTE_TOOL__ = 'timers';
    expect(windowKind()).toBe('tool');
    delete scope.__OPENNOTE_TOOL__;
    window.history.replaceState(null, '', '/?tool=calculator');
    expect(windowKind()).toBe('tool');
    expect(isMainWindow()).toBe(false);
  });

  it('is a capture or page window as the shell names it, and a page window for any other shell window', () => {
    scope.__OPENNOTE_WINDOW__ = { kind: 'capture' };
    expect(windowKind()).toBe('capture');
    scope.__OPENNOTE_WINDOW__ = { kind: 'page' };
    expect(windowKind()).toBe('page');
    scope.__OPENNOTE_WINDOW__ = {};
    expect(windowKind()).toBe('page');
    expect(isMainWindow()).toBe(false);
  });
});
