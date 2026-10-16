// How an account command starts and how it ends. It starts by checking that the account is connected, and says so,
// with a way to Settings, when it isn't. It ends by saying what went wrong in plain words: the connector's own
// sentences for a refusal (offline, expired, missing access) and the service's words for a failed request. It never
// shows a stack, an address, or a token.

import { navigate } from '../../app/location';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import { ConnectorError, ConnectorHttpError, errorText, refreshConnectors } from '../connectors';
import { connectorsStore } from '../connectors';

/** The words a failure is shown with. */
export function failureText(error: unknown, service: string): string {
  if (error instanceof ConnectorError) {
    if (error.code === 'notConnected') return t('accounts.common.notConnected', { service });
    if (error.code === 'missingAccess') return t('accounts.common.needsAccess', { service });
    if (error.code === 'offline') return t('accounts.common.offline', { service });
    return errorText(error.code, service);
  }
  if (error instanceof ConnectorHttpError)
    return t('accounts.common.failed', { service, message: serviceWords(error) });
  return t('accounts.common.failed', { service, message: error instanceof Error ? error.message : '' }).trim();
}

/** The short reason in a service's error body, or the status when the body has none. */
export function serviceWords(error: ConnectorHttpError): string {
  try {
    const body = JSON.parse(error.body) as Record<string, unknown>;
    const nested = body.error;
    const message =
      typeof nested === 'string'
        ? nested
        : typeof (nested as { message?: unknown } | undefined)?.message === 'string'
          ? (nested as { message: string }).message
          : typeof body.message === 'string'
            ? body.message
            : '';
    if (message) return message.slice(0, 200);
  } catch {
    // Not JSON: the status says enough.
  }
  return t('accounts.common.status', { status: error.status });
}

/** Whether the connector is connected, reading the list first when it has not been read. */
export async function isConnected(connector: string): Promise<boolean> {
  if (!connectorsStore.get().loaded) await refreshConnectors();
  return connectorsStore.get().items.some((item) => item.id === connector && item.state.kind === 'connected');
}

/** Says an account isn't connected and offers the way to Settings. */
export function tellNotConnected(service: string): void {
  showToast({
    message: t('accounts.common.notConnected', { service }),
    action: {
      label: t('accounts.common.openSettings'),
      run: () => navigate({ view: 'settings', section: 'connectors' }),
    },
  });
}

/**
 * Runs the work for a command that needs the account. Resolves true when the work finished. Anything it throws is
 * said in words and resolves false.
 */
export async function withAccount(connector: string, service: string, work: () => Promise<void>): Promise<boolean> {
  if (!(await isConnected(connector))) {
    tellNotConnected(service);
    return false;
  }
  return attempt(service, work);
}

/** Runs the work and says what went wrong, without checking the connection first. */
export async function attempt(service: string, work: () => Promise<void>): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (error) {
    const message = failureText(error, service);
    showToast({ message, tone: 'danger' });
    announce(message);
    return false;
  }
}
