import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocation } from '../../app/location';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes/types';
import { getSettings } from '../../state/settings';
import { announcements, expectFocus, expectNoAxeViolations, renderApp } from '../../test';
import type { RenderAppOptions } from '../../test/render';

beforeEach(() => localStorage.clear());

const firstRun = (boot: NonNullable<RenderAppOptions['boot']> = {}): RenderAppOptions => ({
  boot: { firstRun: true, ...boot, state: { setup: { status: 'notStarted' }, ...boot.state } },
});
const button = (name: string) => screen.getByRole('button', { name });
const card = (name: string) => screen.getByRole('radio', { name });
const form = (name: RegExp) => screen.findByRole('form', { name });
const movable = {
  install: { isDevBuild: false, inUserPrograms: false, exePath: 'C:\\Users\\Ada\\Downloads\\OpenNote.exe' },
};

/** Answers create() like the notes service, so finishing has somewhere to go. */
function fakeCreate(notes: NotesService) {
  let count = 0;
  return vi.spyOn(notes, 'create').mockImplementation((input) => {
    const summary: NodeSummary = {
      id: `n${(count += 1)}` as NodeId,
      kind: input.kind,
      parentId: input.placement.parentId,
      title: input.title ?? 'Untitled page',
      color: input.color ?? null,
      pageLevel: 0,
      childCount: 0,
      created: '2026-09-30T09:00:00.000Z',
      modified: '2026-09-30T09:00:00.000Z',
      readOnly: false,
    };
    return Promise.resolve(summary);
  });
}

describe('the first step', () => {
  it('opens on a first run, names the form with its progress, and focuses Get started', async () => {
    const { container } = await renderApp(firstRun());
    expect(await form(/Welcome to OpenNote\s+Step 1 of 3/)).toBeTruthy();
    expect(getLocation()).toEqual({ view: 'setup', step: 'welcome' });
    await expectFocus(button('Get started'));
    expect(announcements()).toEqual([]);
    await expectNoAxeViolations(container);
  });

  it('stays out of the way when setup is done', async () => {
    await renderApp();
    expect(getLocation().view).toBe('workspace');
  });
});

describe('Choose your look', () => {
  it('preselects Match Windows, names the Windows setting, and keeps the choice on Back', async () => {
    const { platform } = await renderApp({ ...firstRun({ os: { dark: true } }) });
    const save = vi.spyOn(platform.settings, 'update');
    fireEvent.click(button('Get started'));
    await screen.findByRole('heading', { name: 'Choose your look' });
    expect(announcements()).toEqual(['Step 2 of 3, Choose your look.']);
    await expectFocus(card('Match Windows'));
    expect(card('Match Windows').getAttribute('aria-checked')).toBe('true');
    expect(card('Match Windows').textContent).toContain('Preselected because Windows is set to Dark.');
    expect(screen.getByText(/press Ctrl\+Shift\+D/)).toBeTruthy();

    fireEvent.click(card('Light'));
    await expect.poll(() => document.documentElement.dataset.theme).toBe('light');
    expect(save).toHaveBeenLastCalledWith({ appearance: { theme: 'light' } });
    expect(card('Match Windows').textContent).toContain('Follows Windows');

    fireEvent.click(button('Back'));
    await screen.findByRole('heading', { name: 'Welcome to OpenNote' });
    fireEvent.click(button('Get started'));
    await screen.findByRole('heading', { name: 'Choose your look' });
    expect(card('Light').getAttribute('aria-checked')).toBe('true');
  });

  it('passes axe in both themes', async () => {
    const { container } = await renderApp(firstRun());
    fireEvent.click(button('Get started'));
    await screen.findByRole('heading', { name: 'Choose your look' });
    await expectNoAxeViolations(container);
    fireEvent.click(card('Dark'));
    await expect.poll(() => document.documentElement.dataset.theme).toBe('dark');
    await expectNoAxeViolations(container);
  });
});

async function toStorage(options: RenderAppOptions = firstRun()) {
  const app = await renderApp(options);
  fireEvent.click(button('Get started'));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Where to keep things' });
  await screen.findByText('OpenNote will create this folder.');
  return app;
}

describe('Where to keep things', () => {
  it('proposes the folder, a first notebook, and names the last button', async () => {
    const { container } = await toStorage();
    expect(announcements()).toContain('Step 3 of 3, Where to keep things.');
    expect(screen.getByText('C:\\Users\\Ada\\Documents\\OpenNote')).toBeTruthy();
    expect((screen.getByLabelText('Notebook name') as HTMLInputElement).value).toBe('My notebook');
    expect(card('Fern').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('This is a development build, so it stays where it is.')).toBeTruthy();
    expect(button('Start taking notes').getAttribute('aria-disabled')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('proposes the Documents folder that Rust reports, ahead of the notes service', async () => {
    await toStorage(firstRun({ install: { proposedNotesFolder: 'D:\\Documents\\OpenNote' } }));
    expect(screen.getByText('D:\\Documents\\OpenNote')).toBeTruthy();
    expect(screen.queryByText('C:\\Users\\Ada\\Documents\\OpenNote')).toBeNull();
  });

  it('asks for a name, and a folder OpenNote can use', async () => {
    const { platform } = await toStorage();
    fireEvent.change(screen.getByLabelText('Notebook name'), { target: { value: ' ' } });
    expect(screen.getByText('Give the notebook a name.', { selector: '[id$="-error"]' })).toBeTruthy();
    expect(button('Start taking notes').getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('Notebook name'), { target: { value: 'Biology 101' } });

    vi.spyOn(platform.install, 'pickNotesFolder').mockResolvedValue('D:\\Locked');
    vi.spyOn(platform.install, 'checkNotesFolder').mockResolvedValue({ kind: 'notWritable' });
    fireEvent.click(button('Change folder'));
    await screen.findByText("OpenNote can't save in this folder. Choose another one.", { selector: 'p' });
    expect(button('Start taking notes').getAttribute('aria-disabled')).toBe('true');
    expect(announcements()).toContain("OpenNote can't save in this folder. Choose another one.");
  });

  it('opens a folder that already has notebooks, and asks for no first notebook', async () => {
    const { platform } = await toStorage();
    vi.spyOn(platform.install, 'pickNotesFolder').mockResolvedValue('D:\\Notes');
    vi.spyOn(platform.install, 'checkNotesFolder').mockResolvedValue({ kind: 'hasLibrary', notebookCount: 3 });
    fireEvent.click(button('Change folder'));
    await screen.findByText('This folder has 3 notebooks. OpenNote will open them.', { selector: 'p' });
    expect(screen.queryByLabelText('Notebook name')).toBeNull();
    expect(button('Start taking notes').getAttribute('aria-disabled')).toBeNull();
  });
});

describe('finishing setup', () => {
  it('saves the folder, makes the notebook, records both scopes, opens the page, and moves the app', async () => {
    const { platform, notes } = await toStorage(firstRun(movable));
    const create = fakeCreate(notes);
    const record = vi.spyOn(platform.state, 'update');
    const move = vi.spyOn(platform.install, 'moveToUserPrograms');
    expect(card('Add OpenNote to the Start menu (recommended)').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(card('Plum'));
    fireEvent.click(button('Start taking notes'));
    await expect.poll(getLocation).toEqual({ view: 'workspace', notebookId: 'n1', sectionId: 'n2', pageId: 'n3' });

    expect(create.mock.calls.map(([input]) => [input.kind, input.title, input.color])).toEqual([
      ['notebook', 'My notebook', 'plum'],
      ['section', 'Quick notes', undefined],
      ['page', undefined, undefined],
    ]);
    expect(getSettings().storage.notesFolder).toBe('C:\\Users\\Ada\\Documents\\OpenNote');
    expect(getSettings().setup.completedSteps).toEqual(['welcome', 'look']);
    expect(record).toHaveBeenCalledWith({
      setup: { status: 'done', step: null, completedSteps: ['storage'], draft: null },
    });
    expect(move).toHaveBeenCalledOnce();
  });

  it('keeps the draft and says what happened when the notebook can not be made', async () => {
    const { platform, notes } = await toStorage();
    vi.spyOn(notes, 'create').mockRejectedValue(new Error('read-only'));
    const record = vi.spyOn(platform.state, 'update');
    fireEvent.click(button('Start taking notes'));
    await screen.findByText("Couldn't finish setting up. Your choices are saved, so you can try again.");
    expect(getLocation()).toEqual({ view: 'setup', step: 'storage' });
    expect(record).not.toHaveBeenCalledWith({ setup: expect.objectContaining({ status: 'done' }) });
  });
});

describe('resuming and new devices', () => {
  it('shows only the device step on a new device with a roaming profile', async () => {
    await renderApp({ ...firstRun(), settings: { setup: { completedSteps: ['welcome', 'look'] } } });
    expect(await form(/Where to keep things\s+Step 1 of 1/)).toBeTruthy();
    expect(button('Start taking notes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('resumes at the saved step with the saved choices', async () => {
    const saved = { status: 'inProgress', step: 'look', draft: { look: { theme: 'dark' } } } as const;
    await renderApp({ ...firstRun({ state: { setup: saved } }), theme: 'dark' });
    expect(getLocation()).toEqual({ view: 'setup', step: 'look' });
    expect(await form(/Choose your look\s+Step 2 of 3/)).toBeTruthy();
    expect(card('Dark').getAttribute('aria-checked')).toBe('true');
  });
});
