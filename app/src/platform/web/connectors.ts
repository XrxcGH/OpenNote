// The web platform's connectors: the in-memory host from the connectors feature. Playwright and `npm run app:dev`
// reach each state through the address:
//   ?connectors=ready       every OAuth connector has a client ID, and a sign-in finishes by itself
//   ?connectors=connected   Google and Canvas are already connected
import { createFakeConnectors } from '../../features/connectors';
import type { ConnectorsClient } from '../../features/connectors';

export function createWebConnectors(search = typeof location === 'undefined' ? '' : location.search): ConnectorsClient {
  const mode = new URLSearchParams(search).get('connectors');
  const ready = mode === 'ready' || mode === 'connected';
  return createFakeConnectors({
    configured: ready ? 'all' : [],
    connected: mode === 'connected' ? { google: 'sam@example.com', canvas: 'Sam Student' } : {},
    autoSignIn: ready ? { afterMs: 800, account: 'sam@example.com' } : undefined,
  }).client;
}
