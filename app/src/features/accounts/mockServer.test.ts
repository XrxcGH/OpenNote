// The mock service itself: route matching by method, host, and path, parameters, wildcards, recording, and paging.
import { describe, expect, it } from 'vitest';
import { MockServer, paged } from '../../../../tests/mock-servers/server';

describe('MockServer', () => {
  const server = new MockServer()
    .route('GET api.example/v1/items/:id', (_request, params) => ({ json: { id: params.id } }))
    .route('POST api.example/v1/items', (request) => ({ status: 201, json: request.json() }))
    .route('GET api.example/files/*', () => ({ text: 'file' }))
    .route('GET api.example/v1/none', () => undefined);

  it('matches the method, host, and path and fills the parameters', () => {
    expect(server.answer('x', { method: 'GET', url: 'https://api.example/v1/items/a%20b' })).toMatchObject({
      status: 200,
      body: '{"id":"a b"}',
    });
    const made = server.answer('x', { method: 'post', url: 'https://api.example/v1/items', body: '{"n":1}' });
    expect(made).toMatchObject({ status: 201, body: '{"n":1}' });
  });

  it('answers 404 for another host, a longer path, or a handler with nothing to say', () => {
    for (const [method, url] of [
      ['GET', 'https://other.example/v1/items/1'],
      ['GET', 'https://api.example/v1/items/1/more'],
      ['GET', 'https://api.example/v1/none'],
      ['DELETE', 'https://api.example/v1/items/1'],
    ]) {
      expect(server.answer('x', { method: method ?? 'GET', url: url ?? '' }).status).toBe(404);
    }
    expect(server.answer('x', { method: 'GET', url: 'https://api.example/files/a/b/c' }).body).toBe('file');
  });

  it('records what it was sent, with the form decoded', () => {
    const recording = new MockServer().route('POST t.example/token', () => ({ json: {} }));
    recording.answer('google', {
      method: 'POST',
      url: 'https://t.example/token?x=1',
      form: { grant_type: 'refresh_token' },
    });
    const seen = recording.requests[0];
    expect(seen?.connector).toBe('google');
    expect(seen?.query).toEqual({ x: '1' });
    expect(seen?.form).toEqual({ grant_type: 'refresh_token' });
    expect(seen?.contentType).toBe('application/x-www-form-urlencoded');
  });

  it('pages a list with a cursor', () => {
    const first = paged([1, 2, 3, 4, 5], { query: {} } as never, 2);
    expect(first).toEqual({ items: [1, 2], next: '2' });
    expect(paged([1, 2, 3, 4, 5], { query: { cursor: '4' } } as never, 2)).toEqual({ items: [5], next: null });
  });
});
