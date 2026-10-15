// What the page shares: the host client, the list of connectors, and the actions that change it. The actions take the
// client as an argument so tests can pass the fake, and they return what happened so the page can say it.

import { commandContext } from '../../commands/registry';
import { createStore, useStore } from '../../state/store';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import type { ConnectorsClient } from './client';
import { errorText, revokeText } from './model';
import { ConnectorError } from './types';
import type { ConnectInput, ConnectorErrorCode, ConnectorInfo } from './types';

/** The host's connectors client. */
export function connectors(): ConnectorsClient {
  return commandContext('menu').platform.connectors;
}

export interface ConnectorsState {
  items: readonly ConnectorInfo[];
  loaded: boolean;
  /** The list could not be read. */
  failed: boolean;
  /** The last failure of each connector, shown on its card until the next try. */
  errors: Readonly<Record<string, ConnectorErrorCode | undefined>>;
}

const EMPTY: ConnectorsState = { items: [], loaded: false, failed: false, errors: {} };
export const connectorsStore = createStore<ConnectorsState>(EMPTY, 'connectors');

export const useConnectorState = (): ConnectorsState => useStore(connectorsStore, (state) => state);

/** Whether a connector is connected and its sign-in still works. For features that offer something only then. */
export function isConnectorConnected(id: string): boolean {
  return connectorsStore.get().items.some((item) => item.id === id && item.state.kind === 'connected');
}

function setError(id: string, code: ConnectorErrorCode | undefined): void {
  connectorsStore.set((state) => ({ ...state, errors: { ...state.errors, [id]: code } }));
}

function replace(view: ConnectorInfo): void {
  connectorsStore.set((state) => ({
    ...state,
    items: state.items.some((item) => item.id === view.id)
      ? state.items.map((item) => (item.id === view.id ? view : item))
      : [...state.items, view],
  }));
}

/** Reads every connector. A failure keeps what is shown and says so. */
export async function refreshConnectors(client: ConnectorsClient = connectors()): Promise<void> {
  try {
    const items = await client.list();
    connectorsStore.set((state) => ({ ...state, items, loaded: true, failed: false }));
  } catch {
    connectorsStore.set((state) => ({ ...state, loaded: true, failed: true }));
  }
}

const nameOf = (id: string): string => connectorsStore.get().items.find((item) => item.id === id)?.name ?? id;

const codeOf = (error: unknown): ConnectorErrorCode => (error instanceof ConnectorError ? error.code : 'unknown');

/**
 * Connects. A service with its own sign-in page opens the browser and waits, so the card shows the wait and offers
 * Cancel. Answers true when the account is connected.
 */
export async function connectTo(
  id: string,
  input?: ConnectInput,
  client: ConnectorsClient = connectors(),
): Promise<boolean> {
  const name = nameOf(id);
  setError(id, undefined);
  const before = connectorsStore.get().items.find((item) => item.id === id);
  if (before?.auth === 'oauth') {
    replace({ ...before, pending: true });
    announce(t('connectors.announce.waiting', { name }));
  }
  try {
    const view = await client.connect(id, input);
    replace(view);
    const account = view.state.kind === 'connected' ? view.state.account : '';
    announce(
      account ? t('connectors.announce.connectedAs', { name, account }) : t('connectors.announce.connected', { name }),
    );
    return true;
  } catch (error) {
    const code = codeOf(error);
    if (code === 'canceled') announce(t('connectors.announce.canceled'));
    else {
      setError(id, code);
      announce(errorText(code, name));
    }
    await refreshConnectors(client);
    return false;
  }
}

export async function cancelSignIn(id: string, client: ConnectorsClient = connectors()): Promise<void> {
  try {
    await client.cancel(id);
  } catch {
    // The sign-in has ended already, and the list below shows how.
  }
}

/** Disconnects, and tells the person what happened at the service. Answers true when it is disconnected. */
export async function disconnectFrom(id: string, client: ConnectorsClient = connectors()): Promise<boolean> {
  const name = nameOf(id);
  setError(id, undefined);
  try {
    const { view, revoke } = await client.disconnect(id);
    replace(view);
    const note = revokeText(revoke, name);
    if (note) showToast({ message: note, announce: note });
    else announce(t('connectors.announce.disconnected', { name }));
    return true;
  } catch (error) {
    const code = codeOf(error);
    setError(id, code);
    announce(errorText(code, name));
    return false;
  }
}

/**
 * Saves the client ID typed on a card that says Needs setup. The host keeps it in the connectors file on this
 * device, and the card then offers Connect. Answers true when it was saved.
 */
export async function saveClient(id: string, clientId: string, clientSecret: string): Promise<boolean> {
  const name = nameOf(id);
  setError(id, undefined);
  try {
    const view = await commandContext('menu').platform.accounts.setClient(id, clientId, clientSecret || undefined);
    replace(view);
    announce(t('connectors.announce.clientSaved', { name }));
    return true;
  } catch {
    setError(id, 'unknown');
    announce(t('connectors.announce.clientRefused'));
    return false;
  }
}
