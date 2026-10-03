// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Location, Navigation } from '../../app/location';
import type { NodeId } from '../../services/notes/types';
import { windowTitleFor } from './history';
import { choiceOf, compactScreenFor } from './useLayoutFollowsNavigation';

const at = (sectionId: string | null, pageId: string | null): Location => ({
  view: 'workspace',
  notebookId: 'n' as NodeId,
  sectionId: sectionId as NodeId | null,
  pageId: pageId as NodeId | null,
});

const push = (from: Location, to: Location, kind: Navigation['kind'] = 'push'): Navigation => ({
  from,
  to,
  kind,
  focus: 'target',
});

describe('choiceOf', () => {
  it('reads a new section from the notebooks pane as a section choice, even with its last page', () => {
    expect(choiceOf(push(at('s1', null), at('s2', 'p9')), 'notebooks')).toBe('section');
  });

  it('reads a new page from the pages pane as a page choice', () => {
    expect(choiceOf(push(at('s1', 'p1'), at('s1', 'p2')), 'pages')).toBe('page');
  });

  it('reads a jump from elsewhere, such as the palette, by what changed', () => {
    expect(choiceOf(push(at('s1', 'p1'), at('s2', 'p5')), null)).toBe('page');
    expect(choiceOf(push(at('s1', 'p1'), at('s2', null)), null)).toBe('section');
  });

  it('ignores arrow-key selection, history steps, and other views', () => {
    expect(choiceOf(push(at('s1', 'p1'), at('s1', 'p2'), 'replace'), 'pages')).toBeNull();
    expect(choiceOf(push(at('s1', 'p1'), at('s1', 'p2'), 'back'), 'pages')).toBeNull();
    expect(choiceOf(push(at('s1', 'p1'), { view: 'settings', section: 'general' }), null)).toBeNull();
  });
});

describe('compactScreenFor', () => {
  it('shows the page, else the pages of the section, else the notebooks', () => {
    expect(compactScreenFor(at('s1', 'p1'))).toBe('page');
    expect(compactScreenFor(at('s1', null))).toBe('pages');
    expect(compactScreenFor(at(null, null))).toBe('notebooks');
  });
});

describe('windowTitleFor', () => {
  const node = (title: string) => ({ title }) as Parameters<typeof windowTitleFor>[1][number];

  it('names the deepest open node, then the app', () => {
    expect(windowTitleFor(at('s1', 'p1'), [node('Biology 101'), node('Lectures'), node('Cell structure')])).toBe(
      'Cell structure - OpenNote',
    );
    expect(windowTitleFor(at('s1', null), [node('Biology 101'), node('Lectures'), null])).toBe('Lectures - OpenNote');
    expect(windowTitleFor(at(null, null), [null, null, null])).toBe('OpenNote');
  });

  it('names Settings, Trash, and setup', () => {
    expect(windowTitleFor({ view: 'settings', section: 'general' }, [])).toBe('Settings - OpenNote');
    expect(windowTitleFor({ view: 'trash' }, [])).toBe('Trash - OpenNote');
    expect(windowTitleFor({ view: 'setup', step: 'welcome' }, [])).toBe('Set up OpenNote');
  });

  it('keeps the title within the 200 characters Rust accepts', () => {
    const title = windowTitleFor(at('s1', 'p1'), [null, null, node('x'.repeat(500))]);
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith(' - OpenNote')).toBe(true);
  });
});
