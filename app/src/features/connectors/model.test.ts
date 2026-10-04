// The page's rules without a screen: groups, search, state lines, buttons, and the sentences, checked against every
// connector in the registry's own list, so a connector, feature, or access ID without a sentence fails here.

import { describe, expect, it } from 'vitest';
import { createFakeConnectors } from './fake';
import {
  accessLines,
  cardActions,
  errorText,
  featureName,
  filterConnectors,
  groupConnectors,
  revokeText,
  stateLine,
  unlocksLine,
} from './model';
import { ERROR_CODES } from './types';
import type { ConnectorInfo } from './types';

const all = (): ConnectorInfo[] => createFakeConnectors({ configured: 'all' }).items;
const named = (id: string): ConnectorInfo => all().find((item) => item.id === id) as ConnectorInfo;

describe('the connector list', () => {
  it('has the nine services, in the five groups, each with a sentence for what it does', () => {
    const items = all();
    expect(items.map((item) => item.id).sort()).toEqual(
      ['box', 'canvas', 'dropbox', 'google', 'microsoft', 'moodle', 'readwise', 'slack', 'vimeo'].sort(),
    );
    expect(groupConnectors(items).map((entry) => entry.group)).toEqual([
      'microsoft',
      'google',
      'storage',
      'learning',
      'other',
    ]);
    for (const item of items) {
      expect(unlocksLine(item), item.id).not.toBe('');
      for (const feature of item.features) expect(featureName(feature), feature).not.toBe(feature);
      for (const line of accessLines(item)) expect(line.text, line.capability).not.toBe(line.capability);
    }
  });

  it('starts every connector off: not connected, or in need of setup when it has no client ID', () => {
    for (const item of createFakeConnectors().items) {
      expect(['notConnected', 'needsSetup']).toContain(item.state.kind);
      expect(item.pending).toBe(false);
    }
    const kinds = createFakeConnectors().items.filter((item) => item.state.kind === 'needsSetup');
    expect(kinds.map((item) => item.auth)).toEqual(Array(kinds.length).fill('oauth'));
  });

  it('says which access can change data and which cannot', () => {
    const google = accessLines(named('google'));
    expect(google.find((line) => line.capability === 'tasksWrite')?.writes).toBe(true);
    expect(google.find((line) => line.capability === 'calendarRead')?.writes).toBe(false);
  });

  it('keeps hosts to the service, and a school connector has none until the person gives an address', () => {
    expect(named('microsoft').hosts).toContain('graph.microsoft.com');
    expect(named('canvas').hosts).toEqual([]);
    for (const item of all()) for (const host of item.hosts) expect(host).toMatch(/^[a-z0-9.-]+\.[a-z]+$/);
  });
});

describe('search', () => {
  it('matches the name, the group, what it does, and the features that use it', () => {
    const items = all();
    const ids = (query: string) => filterConnectors(items, query).map((item) => item.id);
    expect(ids('')).toHaveLength(9);
    expect(ids('canvas')).toEqual(['canvas']);
    expect(ids('LEARNING')).toEqual(['canvas', 'moodle']);
    expect(ids('tasks')).toEqual(['google']);
    expect(ids('outlook')).toEqual(['microsoft']);
    expect(ids('highlights')).toEqual(['readwise']);
    expect(ids('drive tasks')).toEqual(['google']);
    expect(ids('zzz')).toEqual([]);
  });
});

describe('state and buttons', () => {
  const withState = (state: ConnectorInfo['state'], pending = false): ConnectorInfo => ({
    ...named('google'),
    state,
    pending,
  });

  it('names each state in words', () => {
    expect(stateLine(withState({ kind: 'notConnected' })).text).toBe('Not connected');
    expect(stateLine(withState({ kind: 'needsSetup' })).text).toBe('Needs setup');
    expect(stateLine(withState({ kind: 'expired', account: 'sam@example.com' })).text).toBe('Sign-in expired');
    expect(stateLine(withState({ kind: 'connected', account: 'sam@example.com', connectedUnix: 1 })).text).toBe(
      'Connected as sam@example.com',
    );
    expect(stateLine(withState({ kind: 'connected', account: '', connectedUnix: 1 })).text).toBe('Connected');
    expect(stateLine(withState({ kind: 'notConnected' }, true)).text).toMatch(/^Waiting for you to finish/);
  });

  it('offers Connect, Reconnect, Disconnect, Cancel, or the setup steps, and never two ways to the same thing', () => {
    const only = (state: ConnectorInfo['state'], pending = false) =>
      Object.entries(cardActions(withState(state, pending)))
        .filter(([, on]) => on)
        .map(([name]) => name);
    expect(only({ kind: 'notConnected' })).toEqual(['connect']);
    expect(only({ kind: 'needsSetup' })).toEqual(['setup']);
    expect(only({ kind: 'connected', account: 'a', connectedUnix: 1 })).toEqual(['disconnect']);
    expect(only({ kind: 'expired', account: 'a' })).toEqual(['reconnect', 'disconnect']);
    expect(only({ kind: 'notConnected' }, true)).toEqual(['cancel']);
  });
});

describe('sentences', () => {
  it('has a plain sentence for every failure the host can give', () => {
    for (const code of ERROR_CODES) {
      const text = errorText(code, 'Google');
      expect(text, code).toMatch(/^[A-Z].*[.]$/);
      expect(text, code).not.toMatch(/[{}]|!|Oops/);
    }
  });

  it('says what happened at the service after Disconnect', () => {
    expect(revokeText('nothing', 'Dropbox')).toBeNull();
    for (const outcome of ['revoked', 'notSupported', 'skippedOffline', 'failed'] as const) {
      expect(revokeText(outcome, 'Dropbox'), outcome).toMatch(/Dropbox/);
    }
    expect(revokeText('skippedOffline', 'Dropbox')).toMatch(/Work offline/);
  });
});
