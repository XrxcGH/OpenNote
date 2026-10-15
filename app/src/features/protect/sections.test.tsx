// Password-protected sections (A1-39, A2-16, A4-47). The dialogs send what the person typed and say plainly when
// it's wrong. A locked section's pane offers the way in. Sections lock again after the chosen time and when the
// person leaves them. Their pages stay out of recent pages, and the settings are kept.
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { resetFakeShell, setFakeShell } from '../../platform/shellqol';
import type { NodeId, NodeSummary } from '../../services/notes';
import { sessionStore } from '../../state/session';
import { pressChord, renderApp } from '../../test';
import { treeStore } from '../tree';
import {
  isProtectedPage,
  LockedSectionPane,
  loadPrefs,
  lockIfIdle,
  lockLeft,
  protectSection,
  startSectionLocks,
  unlockSection,
  unlockedSections,
} from './sections';

const SECTION = '01m3sa12426sg32pmtyffjaqs1' as NodeId;
const PAGE = '01m3sa12426sg32pmtyffjaqp1' as NodeId;

function node(over: Partial<NodeSummary>): NodeSummary {
  return {
    id: SECTION,
    kind: 'section',
    parentId: null,
    title: 'Diary',
    color: null,
    pageLevel: 0,
    childCount: 1,
    created: '2026-10-01T00:00:00.000Z',
    modified: '2026-10-01T00:00:00.000Z',
    readOnly: false,
    ...over,
  };
}

function seed(protection: 'locked' | 'unlocked') {
  const section = node({ protected: protection });
  const page = node({ id: PAGE, kind: 'page', parentId: SECTION, title: 'Plans', protected: protection });
  treeStore.set((state) => ({ ...state, nodes: { ...state.nodes, [SECTION]: section, [PAGE]: page } }));
  return section;
}

type Call = [string, Record<string, unknown>];

const ok = (name: string) => (name.startsWith('protect.') || name === 'prefs.set' ? { ok: true } : null);

function shell(answer: (name: string, args: Record<string, unknown>) => unknown = ok) {
  const calls: Call[] = [];
  setFakeShell((name, args) => {
    calls.push([name, args]);
    return answer(name, args);
  });
  return calls;
}

afterEach(async () => {
  for (let i = 0; i < 3 && document.querySelector('[role="dialog"]'); i += 1) await pressChord('Escape');
  resetFakeShell();
});

describe('protected sections', () => {
  it('protects a section only with the same password typed twice, at least 8 characters', async () => {
    await renderApp();
    const calls = shell();
    const done = protectSection(node({}));
    const dialog = await screen.findByRole('dialog', { name: 'Protect “Diary” with a password?' });
    expect(within(dialog).getByText(/nobody can open the section/)).toBeTruthy();
    const [first, second] = within(dialog).getAllByLabelText(/password/i);
    await userEvent.type(first, 'short');
    await userEvent.type(second, 'short');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Protect' }));
    expect(await within(dialog).findByText('Use at least 8 characters.')).toBeTruthy();
    await userEvent.clear(first);
    await userEvent.type(first, 'correct horse');
    await userEvent.clear(second);
    await userEvent.type(second, 'correct house');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Protect' }));
    expect(await within(dialog).findByText('The passwords are different.')).toBeTruthy();
    expect(calls.some(([name]) => name === 'protect.protect')).toBe(false);
    await userEvent.clear(second);
    await userEvent.type(second, 'correct horse');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Protect' }));
    expect(await done).toBe(true);
    expect(calls.find(([name]) => name === 'protect.protect')?.[1]).toEqual({ id: SECTION, password: 'correct horse' });
  });

  it('says when the password is wrong, offers Windows Hello when it is set up, and unlocks', async () => {
    await renderApp();
    const section = seed('locked');
    let tries = 0;
    const calls = shell((name) => {
      if (name === 'protect.status') return { protection: 'locked', hello: true, helloAvailable: true };
      if (name === 'protect.unlock' && tries++ === 0)
        throw Object.assign(new Error('wrong'), { code: 'wrongPassword' });
      return ok(name);
    });
    render(<LockedSectionPane section={section} />);
    expect(screen.getByText('This section is locked.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Unlock section…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unlock “Diary”' });
    expect(within(dialog).getByRole('button', { name: 'Use Windows Hello' })).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Password'), 'battery staple');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    expect(await within(dialog).findByText("The password isn't right.")).toBeTruthy();
    expect((within(dialog).getByLabelText('Password') as HTMLInputElement).value).toBe('');
    await userEvent.type(within(dialog).getByLabelText('Password'), 'correct horse');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
    const unlocks = calls.filter(([name]) => name === 'protect.unlock').map(([, args]) => args);
    expect(unlocks).toEqual([
      { id: SECTION, password: 'battery staple' },
      { id: SECTION, password: 'correct horse' },
    ]);
  });

  it('unlocks with Windows Hello without a password', async () => {
    await renderApp();
    const section = seed('locked');
    const calls = shell((name) =>
      name === 'protect.status' ? { protection: 'locked', hello: true, helloAvailable: true } : ok(name),
    );
    const done = unlockSection(section);
    const dialog = await screen.findByRole('dialog', { name: 'Unlock “Diary”' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use Windows Hello' }));
    expect(await done).toBe(true);
    expect(calls.find(([name]) => name === 'protect.unlock')?.[1]).toEqual({ id: SECTION, hello: true });
  });
});

describe('protected sections lock again', () => {
  it('locks again after the chosen time without use, and when the person leaves the section', async () => {
    await renderApp();
    seed('unlocked');
    const calls = shell((name) =>
      name === 'prefs.get' ? { protectIdleMinutes: 5, protectLockOnLeave: true } : ok(name),
    );
    expect(await loadPrefs()).toEqual({ idle: 5, leave: true });
    expect(unlockedSections().map((s) => s.id)).toEqual([SECTION]);
    expect(await lockIfIdle(Date.now() + 60_000)).toEqual([]);
    expect((await lockIfIdle(Date.now() + 6 * 60_000)).map((s) => s.id)).toEqual([SECTION]);
    expect(calls.filter(([name]) => name === 'protect.lock')).toEqual([['protect.lock', { id: SECTION }]]);

    seed('unlocked');
    expect(await lockLeft(SECTION, SECTION)).toBe(false);
    expect(await lockLeft(SECTION, null)).toBe(true);
    shell((name) => (name === 'prefs.get' ? { protectIdleMinutes: 0, protectLockOnLeave: false } : ok(name)));
    await loadPrefs();
    seed('unlocked');
    expect(await lockLeft(SECTION, null)).toBe(false);
    expect(await lockIfIdle(Date.now() + 99 * 60_000)).toEqual([]);
  });

  it('keeps protected pages out of recent pages', async () => {
    await renderApp();
    startSectionLocks();
    seed('unlocked');
    expect(isProtectedPage(PAGE)).toBe(true);
    sessionStore.set((state) => ({ ...state, recentPages: [PAGE] }));
    await expect.poll(() => sessionStore.get().recentPages.includes(PAGE)).toBe(false);
  });

  it("takes a protected page's flashcards and Upcoming items out of browser storage", async () => {
    const { inlineCards, syncInlineDeck, deckById, pageDeckId } = await import('../study');
    const { setPageItems } = await import('../tools');
    const blocks = [
      { id: 'b1', markdown: 'Secret word :: hidden answer' },
      { id: 'b2', markdown: '- [ ] Pay rent 2026-10-20' },
    ];
    syncInlineDeck(PAGE, 'Plans', inlineCards(blocks));
    setPageItems({ id: PAGE, title: 'Plans' }, blocks, { now: Date.parse('2026-10-15'), timeZone: 'UTC' });
    expect(deckById(pageDeckId(PAGE))).toBeDefined();
    const kept = () => Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? '');
    expect(kept().some((value) => value.includes('Pay rent'))).toBe(true);
    await renderApp();
    startSectionLocks();
    seed('unlocked');
    sessionStore.set((state) => ({ ...state, recentPages: [] }));
    await expect.poll(() => deckById(pageDeckId(PAGE))).toBeUndefined();
    await expect
      .poll(() => kept().some((value) => value.includes('hidden answer') || value.includes('Pay rent')))
      .toBe(false);
  });

  it('keeps the lock settings', async () => {
    const calls = shell((name) => (name === 'prefs.get' ? {} : ok(name)));
    await renderApp();
    const { navigate } = await import('../../app/location');
    navigate({ view: 'settings', section: 'storage' });
    await screen.findByRole('heading', { name: 'Protected sections' });
    await userEvent.selectOptions(screen.getByLabelText('Lock after'), '30');
    await userEvent.click(screen.getByRole('switch', { name: 'Lock a protected section when I leave it' }));
    const patches = calls.filter(([name]) => name === 'prefs.set').map(([, args]) => args.patch);
    expect(patches).toEqual([{ protectIdleMinutes: 30 }, { protectLockOnLeave: false }]);
  });
});
