// What the Connectors page shows, as plain functions of the connectors and the person's choices: the groups and the
// search, the line that names a state, which buttons a card offers, and the sentences for access and errors.

import { formatDate } from '../../strings/format';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import type { ConnectorErrorCode, ConnectorGroup, ConnectorInfo, RevokeOutcome } from './types';

/** The order of the groups on the page. */
export const GROUP_ORDER: readonly ConnectorGroup[] = ['microsoft', 'google', 'storage', 'learning', 'other'];

/** The setup steps for every service, one section per connector ID. */
export const SETUP_DOC = 'https://github.com/XrxcGH/OpenNote/blob/main/docs/CONNECTORS.md';

/** A string whose key is built from a connector, feature, or access ID. A missing one gives null, never a crash. */
function dynamic(key: string): string | null {
  try {
    return t(key as MessageKey);
  } catch {
    return null;
  }
}

export const groupName = (group: ConnectorGroup): string => dynamic(`connectors.groups.${group}`) ?? group;
export const unlocksLine = (info: ConnectorInfo): string => dynamic(`connectors.service.${info.id}.unlocks`) ?? '';
export const featureName = (feature: string): string => dynamic(`connectors.feature.${feature}`) ?? feature;

/** What a connector lets OpenNote do, one sentence per capability, with whether it can change data. */
export function accessLines(info: ConnectorInfo): { capability: string; text: string; writes: boolean }[] {
  return info.access.map(({ capability, writes }) => ({
    capability,
    writes,
    text: dynamic(`connectors.access.${capability}`) ?? capability,
  }));
}

/** The connectors in groups, in order, leaving out a group with none. */
export function groupConnectors(items: readonly ConnectorInfo[]): { group: ConnectorGroup; items: ConnectorInfo[] }[] {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter(
    (entry) => entry.items.length > 0,
  );
}

/** The connectors that match a search, by name, group, what they do, or a feature that uses them. */
export function filterConnectors(items: readonly ConnectorInfo[], query: string): ConnectorInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = [item.name, groupName(item.group), unlocksLine(item), ...item.features.map(featureName)]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export type Tone = 'neutral' | 'good' | 'warn';

/** The words that name the state of a card, and a tone for its mark. The words always say it; color never does alone. */
export function stateLine(info: ConnectorInfo): { text: string; tone: Tone } {
  if (info.pending) return { text: t('connectors.state.waiting'), tone: 'neutral' };
  const { state } = info;
  switch (state.kind) {
    case 'connected':
      return {
        text: state.account
          ? t('connectors.state.connected', { account: state.account })
          : t('connectors.state.connectedNoName'),
        tone: 'good',
      };
    case 'expired':
      return { text: t('connectors.state.expired'), tone: 'warn' };
    case 'needsSetup':
      return { text: t('connectors.state.needsSetup'), tone: 'warn' };
    case 'notConnected':
      return { text: t('connectors.state.notConnected'), tone: 'neutral' };
  }
}

/** The date a connection was made, such as "Connected on Sep 30, 2026", or null when it isn't connected. */
export function connectedOnLine(info: ConnectorInfo): string | null {
  if (info.state.kind !== 'connected') return null;
  return t('connectors.state.connectedOn', {
    date: formatDate(new Date(info.state.connectedUnix * 1000).toISOString()),
  });
}

export function lastUsedLine(info: ConnectorInfo): string | null {
  if (info.state.kind === 'notConnected' || info.state.kind === 'needsSetup') return null;
  if (info.lastUsedUnix === null) return t('connectors.detail.neverUsed');
  return t('connectors.detail.lastUsed', { date: formatDate(new Date(info.lastUsedUnix * 1000).toISOString()) });
}

export interface CardActions {
  connect: boolean;
  reconnect: boolean;
  disconnect: boolean;
  cancel: boolean;
  setup: boolean;
}

/** Which buttons a card has. Connect and Reconnect stay, but wait, while Work offline is on. */
export function cardActions(info: ConnectorInfo): CardActions {
  const none: CardActions = { connect: false, reconnect: false, disconnect: false, cancel: false, setup: false };
  if (info.pending) return { ...none, cancel: true };
  switch (info.state.kind) {
    case 'notConnected':
      return { ...none, connect: true };
    case 'needsSetup':
      return { ...none, setup: true };
    case 'connected':
      return { ...none, disconnect: true };
    case 'expired':
      return { ...none, reconnect: true, disconnect: true };
  }
}

/** The sentence for a failure. The cases are written out so each message key is checked as the strings define it. */
export function errorText(code: ConnectorErrorCode, name: string): string {
  switch (code) {
    case 'offline':
      return t('connectors.error.offline');
    case 'unknown':
      return t('connectors.error.unknown');
    case 'notConfigured':
      return t('connectors.error.notConfigured', { name });
    case 'notConnected':
      return t('connectors.error.notConnected', { name });
    case 'expired':
      return t('connectors.error.expired', { name });
    case 'missingAccess':
      return t('connectors.error.missingAccess', { name });
    case 'busy':
      return t('connectors.error.busy', { name });
    case 'canceled':
      return t('connectors.error.canceled');
    case 'timedOut':
      return t('connectors.error.timedOut', { name });
    case 'denied':
      return t('connectors.error.denied', { name });
    case 'mismatch':
      return t('connectors.error.mismatch');
    case 'portInUse':
      return t('connectors.error.portInUse', { name });
    case 'browserFailed':
      return t('connectors.error.browserFailed');
    case 'network':
      return t('connectors.error.network', { name });
    case 'rejected':
      return t('connectors.error.rejected', { name });
    case 'badInput':
      return t('connectors.error.badInput');
    case 'foreignHost':
      return t('connectors.error.foreignHost', { name });
    case 'storage':
      return t('connectors.error.storage', { name });
  }
}

/** What to tell the person after Disconnect, or null when there was nothing to disconnect. */
export function revokeText(outcome: RevokeOutcome, name: string): string | null {
  switch (outcome) {
    case 'nothing':
      return null;
    case 'revoked':
      return t('connectors.revoke.revoked', { name });
    case 'notSupported':
      return t('connectors.revoke.notSupported', { name });
    case 'skippedOffline':
      return t('connectors.revoke.skippedOffline', { name });
    case 'failed':
      return t('connectors.revoke.failed', { name });
  }
}

/** The hosts as one phrase, such as "a.example, b.example". */
export const hostList = (hosts: readonly string[]): string => hosts.join(', ');
