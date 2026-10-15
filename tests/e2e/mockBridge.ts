// Puts a mock service (tests/mock-servers) on a real port, for the app's build with the test-endpoints feature. With
// OPENNOTE_TEST_CONNECTOR_BASE pointing here, the app sends each connector request to
// http://127.0.0.1:<port>/<original host>/<original path and query>, and this answers it from the mock as if it were
// that host. The app's own pinned-host check runs first, so nothing here can make a token go anywhere else.
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MockServer } from '../mock-servers/server';

export interface MockBridge {
  /** The value for OPENNOTE_TEST_CONNECTOR_BASE. */
  readonly base: string;
  close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    request.on('error', fail);
  });
}

export async function startMockBridge(server: MockServer, connector = 'microsoft'): Promise<MockBridge> {
  const http = createServer((request, response) => {
    void (async () => {
      const target = (request.url ?? '/').replace(/^\//, '');
      const body = await readBody(request);
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[name] = value;
      }
      const answer = server.answer(connector, {
        method: request.method ?? 'GET',
        url: `https://${target}`,
        headers,
        ...(body ? { body } : {}),
      });
      response.writeHead(answer.status, {
        ...(answer.contentType ? { 'Content-Type': answer.contentType } : {}),
        ...(answer.location ? { Location: answer.location } : {}),
      });
      response.end(answer.body);
    })().catch(() => {
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const { port } = http.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => http.close(() => done())),
  };
}
