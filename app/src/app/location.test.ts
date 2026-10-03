import { afterEach, describe, expect, it } from 'vitest';
import type { NodeId } from '../services/notes/types';
import { resetStores } from '../state/store';
import {
  canGoBack,
  canGoForward,
  getLocation,
  goBack,
  goForward,
  HISTORY_LIMIT,
  navigate,
  onNavigate,
} from './location';
import type { Location } from './location';

const page = (id: string): Location => ({
  view: 'workspace',
  notebookId: 'n' as NodeId,
  sectionId: 's' as NodeId,
  pageId: id as NodeId,
});

afterEach(() => resetStores());

describe('location history', () => {
  it('pushes, goes back, and goes forward', () => {
    navigate(page('a'));
    navigate({ view: 'settings', section: 'general' });
    expect(goBack()).toBe(true);
    expect(getLocation()).toEqual(page('a'));
    expect(goForward()).toBe(true);
    expect(getLocation()).toEqual({ view: 'settings', section: 'general' });
    expect(goForward()).toBe(false);
  });

  it('replaces the current entry without adding history', () => {
    navigate(page('a'));
    navigate(page('b'), { replace: true });
    expect(goBack()).toBe(true);
    expect(getLocation().view).toBe('workspace');
    expect(goBack()).toBe(false);
  });

  it('ignores navigating to where the person already is', () => {
    navigate(page('a'));
    navigate(page('a'));
    expect(goBack()).toBe(true);
    expect(goBack()).toBe(false);
  });

  it('tells listeners how the location changed', () => {
    const seen: string[] = [];
    const stop = onNavigate(({ from, to, kind, focus }) => {
      seen.push(
        `${kind} ${focus} ${from.view === 'workspace' ? from.pageId : from.view} > ${to.view === 'workspace' ? to.pageId : to.view}`,
      );
    });
    navigate(page('a'));
    navigate(page('b'), { replace: true, focus: 'keep' });
    navigate({ view: 'trash' });
    goBack();
    goForward();
    navigate({ view: 'trash' });
    stop();
    navigate(page('c'));
    expect(seen).toEqual([
      'push target null > a',
      'replace keep a > b',
      'push target b > trash',
      'back target trash > b',
      'forward target b > trash',
    ]);
  });

  it('reports whether there is history each way', () => {
    expect([canGoBack(), canGoForward()]).toEqual([false, false]);
    navigate(page('a'));
    expect([canGoBack(), canGoForward()]).toEqual([true, false]);
    goBack();
    expect([canGoBack(), canGoForward()]).toEqual([false, true]);
  });

  it('drops forward history on a new push and keeps at most 50 entries back', () => {
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) navigate(page(String(i)));
    let steps = 0;
    while (goBack()) steps += 1;
    expect(steps).toBe(HISTORY_LIMIT);
    navigate(page('new'));
    expect(goForward()).toBe(false);
  });
});
