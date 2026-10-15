// Page, section, and notebook shortcuts: the link each one starts OpenNote with, and the place it goes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeId, NodeSummary } from '../../services/notes';

const calls: { name: string; args: Record<string, unknown> | undefined }[] = [];
let answer: { path: string } | null = { path: 'C:/x.lnk' };
vi.mock('../../platform/shellqol', () => ({
  shellCall: async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    return answer;
  },
}));
vi.mock('../../ui', () => ({ showToast: vi.fn() }));

const { makeShortcut, shortcutLink } = await import('./shortcuts');

const node = (kind: NodeSummary['kind'], id: string, title: string) => ({ id: id as NodeId, kind, title }) as NodeSummary;

beforeEach(() => {
  calls.length = 0;
  answer = { path: 'C:/x.lnk' };
});

describe('shortcut links', () => {
  it('open a page, or a section or notebook itself', () => {
    expect(shortcutLink(node('page', 'p1', 'Mitosis'))).toBe('opennote://page/p1');
    expect(shortcutLink(node('section', 's1', 'Labs'))).toBe('opennote://section/s1');
    expect(shortcutLink(node('notebook', 'n1', 'Biology'))).toBe('opennote://notebook/n1');
    expect(shortcutLink(node('sectionGroup', 'g1', 'Group'))).toBeNull();
  });
});

describe('making a shortcut', () => {
  it('sends the place, and the folder only for a folder', async () => {
    expect(await makeShortcut(node('section', 's1', 'Labs'), { place: 'startMenu', folder: 'ignored' })).toBe(true);
    expect(calls[0]).toEqual({
      name: 'shortcut.create',
      args: { url: 'opennote://section/s1', title: 'Labs', place: 'startMenu' },
    });
    await makeShortcut(node('notebook', 'n1', 'Biology'), { place: 'folder', folder: 'D:/Notes' });
    expect(calls[1].args).toEqual({
      url: 'opennote://notebook/n1',
      title: 'Biology',
      place: 'folder',
      folder: 'D:/Notes',
    });
  });

  it('reports a shortcut the host could not make', async () => {
    answer = null;
    expect(await makeShortcut(node('page', 'p1', 'Mitosis'), { place: 'desktop', folder: null })).toBe(false);
    expect(await makeShortcut(node('sectionGroup', 'g1', 'Group'), { place: 'desktop', folder: null })).toBe(false);
  });
});
