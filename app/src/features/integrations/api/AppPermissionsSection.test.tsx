// App permissions on the fake host: the apps with what each may do, Revoke, the access log, a pairing code, the
// MCP config, and the questions OpenNote asks before an app connects or changes notes.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderApp } from '../../../test';
import AppPermissionsSection from './AppPermissionsSection';
import { startApprovals } from './approvals';
import { createFakeApi, setApiHost } from './host';
import type { FakeApi } from './host';
import type { AppGrant } from './types';

const cli: AppGrant = {
  id: '0123456789abcdef',
  name: 'opennote',
  kind: 'cli',
  created: 1_790_000_000,
  lastUsed: null,
  access: 'read',
  askBeforeWrites: true,
  notebooks: { kind: 'notebooks', ids: [] },
};

let fake: FakeApi;

beforeEach(async () => {
  await renderApp();
  fake = createFakeApi({ apps: [{ ...cli }] });
  setApiHost(fake.host);
});

afterEach(() => {
  cleanup();
  setApiHost(null);
});

describe('App permissions', () => {
  it('lists each app with what it may do, and saves a change', async () => {
    render(<AppPermissionsSection />);
    const card = await screen.findByRole('article', { name: 'opennote' });
    expect(within(card).getByText('opennote command')).toBeTruthy();
    expect(within(card).getByText(/Not used yet/)).toBeTruthy();
    const access = within(card).getByRole('combobox', { name: 'What it can do' });
    expect((access as HTMLSelectElement).value).toBe('read');
    fireEvent.change(access, { target: { value: 'readWrite' } });
    await waitFor(() => expect(fake.state.apps[0].access).toBe('readWrite'));
    fireEvent.click(within(card).getByRole('radio', { name: 'Every notebook' }));
    await waitFor(() => expect(fake.state.apps[0].notebooks).toEqual({ kind: 'all' }));
    expect(within(card).getByText('Locked sections are never shared with any app.')).toBeTruthy();
  });

  it('revokes an app only after the person confirms', async () => {
    render(<AppPermissionsSection />);
    const card = await screen.findByRole('article', { name: 'opennote' });
    fireEvent.click(within(card).getByRole('button', { name: 'Revoke opennote' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revoke opennote?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'opennote' })).toBeNull());
    expect(fake.state.apps).toHaveLength(0);
    expect(screen.getByText(/No apps are connected/)).toBeTruthy();
  });

  it('shows the access log and turns the listener off', async () => {
    fake.state.log = [
      { time: Date.now(), app: cli.id, name: 'opennote', action: 'page.read', title: 'Biology', outcome: 'allowed' },
      { time: Date.now(), app: cli.id, name: 'opennote', action: 'page.read', outcome: 'refused', detail: 'locked' },
    ];
    render(<AppPermissionsSection />);
    const table = await screen.findByRole('table', { name: 'Access log' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('Refused (locked)')).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: 'Let apps on this PC connect' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() => expect(fake.state.status.running).toBe(false));
    expect(await screen.findByText('No app can connect right now.')).toBeTruthy();
  });

  it('makes a pairing code and copies the MCP config', async () => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => ((copied = text), Promise.resolve()) },
    });
    render(<AppPermissionsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make a pairing code' }));
    expect(await screen.findByText('Pairing code: K7Q2-M9XD')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP config' }));
    await waitFor(() => expect(copied).toContain('"mcp"'));
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<AppPermissionsSection />);
    await screen.findByRole('article', { name: 'opennote' });
    await expectNoAxeViolations(container);
  });
});

describe('the questions', () => {
  it('asks before a new app connects, and starts it reading only', async () => {
    const approvals = startApprovals(fake.host);
    fake.ask({ id: 'q1', appName: 'My script', question: { kind: 'connect', appKind: 'app', wants: 'read' } });
    const dialog = await screen.findByRole('dialog', { name: 'Let My script connect to OpenNote?' });
    expect(document.activeElement?.textContent).toBe('Don’t allow');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Every notebook' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(fake.state.decided).toHaveLength(1));
    expect(fake.state.decided[0].decision).toEqual({ kind: 'allow', access: 'read', notebooks: { kind: 'all' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    approvals.stop();
  });

  it('says no to a change, and closes when the shell stops waiting', async () => {
    const approvals = startApprovals(fake.host);
    fake.ask({
      id: 'q2',
      appName: 'opennote',
      question: { kind: 'change', action: 'add to this page', target: 'Ideas' },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Allow this change?' });
    expect(within(dialog).getByText('opennote wants to add to this page, in “Ideas”.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Don’t allow' }));
    await waitFor(() => expect(fake.state.decided).toEqual([{ id: 'q2', decision: { kind: 'deny' } }]));

    fake.ask({
      id: 'q3',
      appName: 'opennote',
      question: { kind: 'change', action: 'add to this page', target: 'Ideas' },
    });
    await screen.findByRole('dialog', { name: 'Allow this change?' });
    fake.state.pending = [];
    fake.emit({ kind: 'answered', id: 'q3' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    approvals.stop();
  });
});

describe('webhooks and the opennote command', () => {
  it('adds a webhook with an https address only, and shows a made secret once', async () => {
    render(<AppPermissionsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a webhook' }));
    const dialog = await screen.findByRole('dialog', { name: 'Webhook' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Zapier' } });
    const url = within(dialog).getByLabelText('Address (https only)');
    fireEvent.change(url, { target: { value: 'http://hooks.zapier.com/x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(fake.state.webhooks).toHaveLength(0);
    fireEvent.change(url, { target: { value: 'https://hooks.zapier.com/hooks/catch/1/abc/' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'A tag is added' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fake.state.webhooks).toHaveLength(1));
    expect(fake.state.webhooks[0]).toMatchObject({
      name: 'Zapier',
      events: ['pageCreated', 'tagAdded'],
      includeText: false,
      enabled: true,
    });
    expect(await screen.findByText(/made this signing secret/)).toBeTruthy();
    const card = await screen.findByRole('article', { name: 'Zapier' });
    fireEvent.click(within(card).getByRole('button', { name: 'Remove Zapier' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Remove Zapier?' })).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() => expect(fake.state.webhooks).toHaveLength(0));
  });

  it('adds the opennote command to PATH only when asked', async () => {
    render(<AppPermissionsSection />);
    const toggle = await screen.findByRole('switch', { name: 'Add the opennote command to PATH' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(fake.state.cli.onPath).toBe(true));
  });
});
