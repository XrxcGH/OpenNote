// The Connectors page on the fake host: the cards in each state, signing in and out, a pasted token, the school's
// address, Work offline, search, and the Privacy rows. The fake host stands in for the shell, so no browser opens.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExternalTarget } from '../../platform/types';
import { announcements, expectNoAxeViolations, renderApp } from '../../test';
import { privacyStore } from '../diagnostics';
import ConnectorsSection from './ConnectorsSection';
import { createFakeConnectors } from './fake';
import type { FakeConnectors, FakeOptions } from './fake';
import { ConnectorNetworkUse } from './NetworkUse';

async function setup(options: FakeOptions = {}) {
  const app = await renderApp();
  const fake = createFakeConnectors({ offline: () => privacyStore.get().workOffline, ...options });
  // Opening a page or a folder is recorded, so no test leaves the page.
  const opened: ExternalTarget[] = [];
  const shell = { openExternal: (target: ExternalTarget) => (opened.push(target), Promise.resolve()) };
  Object.assign(app.platform, { connectors: fake.client, shell });
  return { app, fake, opened };
}

const states = (fake: FakeConnectors, id: string) => fake.items.find((item) => item.id === id)?.state.kind;

afterEach(() => {
  cleanup();
  privacyStore.set((state) => ({ ...state, workOffline: false }));
});

describe('the list', () => {
  it('shows every connector in its group, off until the person connects it', async () => {
    await setup({ configured: ['google'] });
    const { container } = render(<ConnectorsSection />);
    await screen.findByRole('article', { name: 'Google' });
    const card = (name: string) => within(container).getByRole('article', { name });
    for (const group of ['Microsoft', 'Google', 'Storage', 'Learning platforms', 'Other']) {
      expect(screen.getByRole('heading', { level: 2, name: group })).toBeTruthy();
    }
    expect(within(container).getAllByRole('article')).toHaveLength(9);
    expect(within(card('Google')).getByText('Not connected')).toBeTruthy();
    expect(within(card('Microsoft')).getByText('Needs setup')).toBeTruthy();
    expect(within(card('Readwise')).getByText('Not connected')).toBeTruthy();
    expect(within(card('Canvas')).getByText('Not connected')).toBeTruthy();
    expect(screen.queryByText(/Connected as/)).toBeNull();
  });

  it('says in plain words what connecting unlocks and what OpenNote will be able to do', async () => {
    await setup({ configured: 'all' });
    render(<ConnectorsSection />);
    const google = await screen.findByRole('article', { name: 'Google' });
    expect(within(google).getByText(/Meeting notes from Calendar events/)).toBeTruthy();
    fireEvent.click(within(google).getByText('What this allows'));
    expect(within(google).getByText('Read your calendar events. It cannot change them.')).toBeTruthy();
    expect(within(google).getByText('Read and change your tasks.')).toBeTruthy();
    expect(within(google).getByText('Google Classroom assignments')).toBeTruthy();
    expect(within(google).getByText(/OpenNote talks only to accounts\.google\.com/)).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    await setup({ configured: ['google'], connected: { dropbox: 'sam@example.com' } });
    const { container } = render(<ConnectorsSection />);
    await screen.findByRole('article', { name: 'Google' });
    await expectNoAxeViolations(container);
  });
});

describe('signing in with the service’s own page', () => {
  it('waits for the browser, then shows Connected as the person’s account', async () => {
    const { fake } = await setup({ configured: ['google'] });
    render(<ConnectorsSection />);
    const google = await screen.findByRole('article', { name: 'Google' });
    fireEvent.click(within(google).getByRole('button', { name: 'Connect' }));
    await within(google).findByText('Waiting for you to finish signing in, in your browser');
    expect(within(google).queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(announcements()).toContain('Opened Google in your browser. Finish signing in there.');
    fake.finishSignIn('google', 'sam@example.com');
    await within(google).findByText('Connected as sam@example.com');
    expect(within(google).getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(within(google).getByText(/^Connected on /)).toBeTruthy();
    expect(announcements()).toContain('Connected to Google as sam@example.com.');
  });

  it('cancels a sign-in that is waiting', async () => {
    const { fake } = await setup({ configured: ['google'] });
    render(<ConnectorsSection />);
    const google = await screen.findByRole('article', { name: 'Google' });
    fireEvent.click(within(google).getByRole('button', { name: 'Connect' }));
    fireEvent.click(await within(google).findByRole('button', { name: 'Cancel sign-in' }));
    await within(google).findByText('Not connected');
    expect(fake.calls).toContain('cancel:google');
    expect(announcements()).toContain('Sign-in canceled.');
    expect(within(google).queryByText(/was not finished/)).toBeNull();
  });

  it('says why a sign-in failed, in words, and keeps Connect for another try', async () => {
    const { fake } = await setup({ configured: ['google'] });
    render(<ConnectorsSection />);
    const google = await screen.findByRole('article', { name: 'Google' });
    fireEvent.click(within(google).getByRole('button', { name: 'Connect' }));
    await within(google).findByText('Waiting for you to finish signing in, in your browser');
    fake.failSignIn('google', 'timedOut');
    await within(google).findByText(/The sign-in to Google was not finished in 5 minutes/);
    expect(within(google).getByText('Not connected')).toBeTruthy();
    fireEvent.click(within(google).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(within(google).queryByText(/was not finished/)).toBeNull());
    fake.failSignIn('google', 'denied');
    await within(google).findByText('You did not allow access, so Google is not connected.');
  });

  it('shows Needs setup with the steps, and never starts a sign-in', async () => {
    const { fake, opened } = await setup();
    render(<ConnectorsSection />);
    const microsoft = await screen.findByRole('article', { name: 'Microsoft' });
    expect(within(microsoft).queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(within(microsoft).getByText(/has no client ID for Microsoft/)).toBeTruthy();
    fireEvent.click(within(microsoft).getByRole('button', { name: 'Open setup guide in your browser' }));
    fireEvent.click(within(microsoft).getByRole('button', { name: 'Open the connectors folder' }));
    expect(opened).toEqual([
      { kind: 'link', url: 'https://github.com/XrxcGH/OpenNote/blob/main/docs/CONNECTORS.md#microsoft' },
      { kind: 'folder', which: 'data' },
    ]);
    expect(fake.calls).toEqual([]);
  });
});

describe('Disconnect and Reconnect', () => {
  it('asks first, then disconnects and tells the person what happened at the service', async () => {
    const { fake } = await setup({ connected: { dropbox: 'sam@example.com' }, revoke: 'notSupported' });
    render(<ConnectorsSection />);
    const dropbox = await screen.findByRole('article', { name: 'Dropbox' });
    fireEvent.click(within(dropbox).getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Dropbox?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fake.calls).toEqual([]);
    fireEvent.click(within(dropbox).getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(states(fake, 'dropbox')).not.toBe('connected'));
    await waitFor(() => expect(announcements().join(' ')).toMatch(/Dropbox is disconnected here/));
  });

  it('offers Reconnect beside Disconnect when the sign-in expired', async () => {
    const { fake } = await setup({ configured: 'all', connected: { google: 'sam@example.com' } });
    (fake.items.find((item) => item.id === 'google') as { state: unknown }).state = {
      kind: 'expired',
      account: 'sam@example.com',
    };
    render(<ConnectorsSection />);
    const google = await screen.findByRole('article', { name: 'Google' });
    expect(within(google).getByText('Sign-in expired')).toBeTruthy();
    expect(within(google).getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    fireEvent.click(within(google).getByRole('button', { name: 'Reconnect' }));
    await within(google).findByText('Waiting for you to finish signing in, in your browser');
    fake.finishSignIn('google', 'sam@example.com');
    await within(google).findByText('Connected as sam@example.com');
  });
});

describe('a pasted token', () => {
  it('opens a form with a hidden token field, connects, and clears the token', async () => {
    const { fake } = await setup();
    render(<ConnectorsSection />);
    const readwise = await screen.findByRole('article', { name: 'Readwise' });
    const connect = within(readwise).getByRole('button', { name: 'Connect' });
    expect(connect.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(connect);
    expect(connect.getAttribute('aria-expanded')).toBe('true');
    const field = within(readwise).getByLabelText('Personal token') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'pasted-token-123' } });
    fireEvent.click(within(readwise).getByRole('button', { name: 'Connect with this token' }));
    await within(readwise).findByText('Connected');
    expect(fake.inputs.readwise).toEqual({ token: 'pasted-token-123' });
    expect(within(readwise).queryByLabelText('Personal token')).toBeNull();
    expect(readwise.textContent).not.toContain('pasted-token-123');
  });

  it('asks a school connector for its address, and keeps the form open when the service says no', async () => {
    const { fake } = await setup();
    render(<ConnectorsSection />);
    const canvas = await screen.findByRole('article', { name: 'Canvas' });
    fireEvent.click(within(canvas).getByRole('button', { name: 'Connect' }));
    fireEvent.change(within(canvas).getByLabelText('School address'), { target: { value: 'school.instructure.com' } });
    fireEvent.change(within(canvas).getByLabelText('Personal token'), { target: { value: 'short' } });
    fireEvent.click(within(canvas).getByRole('button', { name: 'Connect with this token' }));
    await within(canvas).findByText(/Check the school address and the token/);
    expect(within(canvas).getByLabelText('School address')).toBeTruthy();
    expect((within(canvas).getByLabelText('Personal token') as HTMLInputElement).value).toBe('');
    fireEvent.change(within(canvas).getByLabelText('Personal token'), { target: { value: 'a-long-enough-token' } });
    fireEvent.click(within(canvas).getByRole('button', { name: 'Connect with this token' }));
    await within(canvas).findByText('Connected as Sam Student');
    expect(fake.inputs.canvas?.baseUrl).toBe('school.instructure.com');
    fireEvent.click(within(canvas).getByText('What this allows'));
    expect(within(canvas).getByText(/OpenNote talks only to school\.instructure\.com/)).toBeTruthy();
  });

  it('closes the form with Escape', async () => {
    await setup();
    render(<ConnectorsSection />);
    const readwise = await screen.findByRole('article', { name: 'Readwise' });
    fireEvent.click(within(readwise).getByRole('button', { name: 'Connect' }));
    fireEvent.keyDown(within(readwise).getByLabelText('Personal token'), { key: 'Escape' });
    expect(within(readwise).queryByLabelText('Personal token')).toBeNull();
  });
});

describe('Work offline', () => {
  it('keeps Connect waiting, says why, and starts nothing', async () => {
    const { fake } = await setup({ configured: ['google'] });
    render(<ConnectorsSection />);
    const google = await screen.findByRole('article', { name: 'Google' });
    privacyStore.set((state) => ({ ...state, workOffline: true }));
    const notice = await screen.findByText(/Work offline is on, so signing in and renewing wait/);
    const connect = within(google).getByRole('button', { name: 'Connect' });
    expect(connect.getAttribute('aria-disabled')).toBe('true');
    expect(connect.getAttribute('aria-describedby')).toContain(notice.id);
    fireEvent.click(connect);
    expect(fake.calls).toEqual([]);
    privacyStore.set((state) => ({ ...state, workOffline: false }));
    await waitFor(() => expect(screen.queryByText(/Work offline is on/)).toBeNull());
    expect(within(google).getByRole('button', { name: 'Connect' }).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('search', () => {
  it('narrows the list and says how many match', async () => {
    await setup({ configured: 'all' });
    const { container } = render(<ConnectorsSection />);
    await screen.findByRole('article', { name: 'Google' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search connectors' }), { target: { value: 'canvas' } });
    await waitFor(() => expect(within(container).getAllByRole('article')).toHaveLength(1));
    expect(screen.getByRole('heading', { level: 2, name: 'Learning platforms' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Google' })).toBeNull();
    expect(announcements()).toContain('1 connector matches.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search connectors' }), { target: { value: 'zzz' } });
    expect(await within(container).findByText('No connectors match that search.')).toBeTruthy();
    expect(within(container).queryAllByRole('article')).toHaveLength(0);
  });
});

describe('in Privacy', () => {
  it('lists each connector’s servers and says nothing is contacted before the person connects', async () => {
    await setup({ connected: { google: 'sam@example.com' } });
    render(
      <ul>
        <ConnectorNetworkUse />
      </ul>,
    );
    await screen.findByText('Connected accounts');
    expect(screen.getByText(/Google uses accounts\.google\.com/)).toBeTruthy();
    expect(screen.getByText('Dropbox is not connected, so OpenNote makes no requests to it.')).toBeTruthy();
    expect(screen.getByText(/Sign-in, renewing, and requests happen only while you are online/)).toBeTruthy();
    privacyStore.set((state) => ({ ...state, workOffline: true }));
    expect(await screen.findByText('Sign-in and requests are blocked while you work offline.')).toBeTruthy();
  });
});
