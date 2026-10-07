// The typed request helper: how an address is built, what a request holds, and how the answer is read. The fake
// connectors stand in for the host, and a mock service answers.
import { describe, expect, it } from 'vitest';
import { MockServer } from '../../../../tests/mock-servers/server';
import { createFakeConnectors } from './fake';
import { buildUrl, ConnectorHttpError, requestConnector, toRequest } from './request';
import { ConnectorError } from './types';

describe('buildUrl', () => {
  it('joins a path to the base and encodes the query, leaving out empty values', () => {
    expect(
      buildUrl({
        base: 'https://graph.microsoft.com/v1.0/',
        url: '/me/events',
        query: { $top: 10, $select: 'subject,start', skip: undefined, none: null, a: false },
      }),
    ).toBe('https://graph.microsoft.com/v1.0/me/events?%24top=10&%24select=subject%2Cstart&a=false');
  });

  it('keeps a full address and adds to a query that is there', () => {
    expect(buildUrl({ url: 'https://readwise.io/api/v2/export/?x=1', query: { pageCursor: 'abc' } })).toBe(
      'https://readwise.io/api/v2/export/?x=1&pageCursor=abc',
    );
  });
});

describe('toRequest', () => {
  it('sends JSON with a content type, defaults to GET or POST, and asks for JSON back', () => {
    const post = toRequest({ url: 'https://slack.com/api/chat.postMessage', json: { channel: 'C1' } });
    expect(post).toMatchObject({ method: 'POST', contentType: 'application/json', body: '{"channel":"C1"}' });
    expect(post.headers).toEqual({ Accept: 'application/json' });
    expect(toRequest({ url: 'https://slack.com/api/auth.test' }).method).toBe('GET');
  });

  it('sends form fields as a form and keeps the caller’s own Accept header', () => {
    const request = toRequest({ url: 'https://x.example/api', form: { a: 'b' }, headers: { accept: 'text/plain' } });
    expect(request.form).toEqual({ a: 'b' });
    expect(request.body).toBeUndefined();
    expect(request.headers).toEqual({ accept: 'text/plain' });
  });
});

describe('requestConnector', () => {
  const server = new MockServer()
    .route('GET graph.microsoft.com/v1.0/me', () => ({ json: { displayName: 'Sam' } }))
    .route('GET graph.microsoft.com/v1.0/gone', () => ({ status: 404, json: { error: { message: 'It is gone.' } } }))
    .route('GET graph.microsoft.com/v1.0/text', () => ({ text: 'plain words', contentType: 'text/plain' }));
  const { client } = createFakeConnectors({ connected: { microsoft: 'sam@example.com' }, respond: server.respond });
  const base = 'https://graph.microsoft.com/v1.0';

  it('reads a JSON answer as a typed value', async () => {
    const reply = await requestConnector<{ displayName: string }>(
      'microsoft',
      ['calendarRead'],
      { base, url: 'me' },
      client,
    );
    expect(reply.status).toBe(200);
    expect(reply.data?.displayName).toBe('Sam');
    expect(server.requests.at(-1)?.headers.accept).toBe('application/json');
  });

  it('throws the service’s words for a failure, unless the caller accepts that status', async () => {
    const failure = await requestConnector('microsoft', [], { base, url: 'gone' }, client).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConnectorHttpError);
    expect((failure as ConnectorHttpError).status).toBe(404);
    expect((failure as ConnectorHttpError).body).toContain('It is gone.');
    const accepted = await requestConnector('microsoft', [], { base, url: 'gone', accept: [404] }, client);
    expect(accepted.status).toBe(404);
  });

  it('leaves data undefined for an answer that is not JSON, and passes the host’s refusals through', async () => {
    const reply = await requestConnector('microsoft', [], { base, url: 'text' }, client);
    expect(reply.text).toBe('plain words');
    expect(reply.data).toBeUndefined();
    const lonely = createFakeConnectors({ respond: server.respond }).client;
    await expect(requestConnector('microsoft', [], { base, url: 'me' }, lonely)).rejects.toBeInstanceOf(ConnectorError);
  });
});
