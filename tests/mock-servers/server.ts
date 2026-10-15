// A mock service for the account features' tests. It is the other end of `requestConnector`: a table of routes keyed by
// method, host, and path, that answers a ConnectorRequest the way the real service would, and records every request so
// a test can check what OpenNote sent. It runs in the test's own process, so no port, token, or account is involved.
// Plug it into the in-memory connectors with `createFakeConnectors({ respond: server.respond })`.
//
// A pattern is `METHOD host/path`, where `:name` matches one path segment and `*` matches the rest, such as
// `GET graph.microsoft.com/v1.0/me/events/:id`. The first route that matches wins.

export interface MockRequest {
  method: string;
  /** The address as sent. */
  url: string;
  host: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** The body as text, or an empty string. */
  body: string;
  /** The form fields when the body was a form. */
  form: Record<string, string>;
  contentType: string;
  /** The connector the request went through. */
  connector: string;
  /** The body read as JSON, or undefined. */
  json<T = unknown>(): T | undefined;
}

export interface MockReply {
  status?: number;
  json?: unknown;
  text?: string;
  contentType?: string;
  location?: string;
}

export type Handler = (request: MockRequest, params: Readonly<Record<string, string>>) => MockReply | undefined;

export interface MockResponse {
  status: number;
  contentType: string | null;
  body: string;
  location: string | null;
}

export interface WireRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  contentType?: string;
  form?: Record<string, string>;
}

interface Route {
  method: string;
  host: string;
  segments: string[];
  handler: Handler;
}

function parsePattern(pattern: string): Omit<Route, 'handler'> {
  const [method = 'GET', target = ''] = pattern.split(/\s+/, 2);
  const slash = target.indexOf('/');
  const host = slash < 0 ? target : target.slice(0, slash);
  const path = slash < 0 ? '' : target.slice(slash + 1);
  return { method: method.toUpperCase(), host: host.toLowerCase(), segments: path.split('/').filter(Boolean) };
}

function match(route: Route, request: MockRequest): Record<string, string> | null {
  if (route.method !== request.method || route.host !== request.host) return null;
  const actual = request.path.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let at = 0; at < route.segments.length; at += 1) {
    const want = route.segments[at] ?? '';
    if (want === '*') return params;
    const have = actual[at];
    if (have === undefined) return null;
    if (want.startsWith(':')) params[want.slice(1)] = decodeURIComponent(have);
    else if (want !== have) return null;
  }
  return actual.length === route.segments.length ? params : null;
}

function toRequest(wire: WireRequest, connector: string): MockRequest {
  const url = new URL(wire.url);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(wire.headers ?? {})) headers[name.toLowerCase()] = value;
  const form = wire.form ?? {};
  const body = wire.body ?? (wire.form ? new URLSearchParams(wire.form).toString() : '');
  return {
    method: wire.method.toUpperCase(),
    url: wire.url,
    host: url.host.toLowerCase(),
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers,
    body,
    form,
    contentType:
      wire.contentType ?? (wire.form ? 'application/x-www-form-urlencoded' : (headers['content-type'] ?? '')),
    connector,
    json: <T>() => {
      try {
        return JSON.parse(body) as T;
      } catch {
        return undefined;
      }
    },
  };
}

export class MockServer {
  /** Every request the server answered, in order. */
  readonly requests: MockRequest[] = [];
  private readonly routes: Route[] = [];

  /** Adds a route. A reply of undefined from the handler means "no such thing" and answers 404. */
  route(pattern: string, handler: Handler): this {
    this.routes.push({ ...parsePattern(pattern), handler });
    return this;
  }

  /** The requests that matched this method and path prefix. */
  requestsTo(method: string, pathPrefix: string): MockRequest[] {
    return this.requests.filter((one) => one.method === method.toUpperCase() && one.path.startsWith(pathPrefix));
  }

  /** The answer to a request, as the connectors client would return it. */
  answer(connector: string, wire: WireRequest): MockResponse {
    const request = toRequest(wire, connector);
    this.requests.push(request);
    for (const route of this.routes) {
      const params = match(route, request);
      if (!params) continue;
      const reply = route.handler(request, params);
      return reply ? finish(reply) : finish({ status: 404, json: { error: { message: 'Not found.' } } });
    }
    return finish({
      status: 404,
      json: { error: { message: `No route for ${request.method} ${request.host}${request.path}.` } },
    });
  }

  /** For `createFakeConnectors({ respond })`. */
  readonly respond = (connector: string, wire: WireRequest): MockResponse => this.answer(connector, wire);
}

function finish(reply: MockReply): MockResponse {
  const status = reply.status ?? 200;
  if (reply.json !== undefined) {
    return {
      status,
      contentType: reply.contentType ?? 'application/json',
      body: JSON.stringify(reply.json),
      location: reply.location ?? null,
    };
  }
  return { status, contentType: reply.contentType ?? null, body: reply.text ?? '', location: reply.location ?? null };
}

/** Pages a list the way most services do: `limit` items at a time, with a cursor. */
export function paged<T>(
  items: readonly T[],
  request: MockRequest,
  pageSize: number,
  cursorName = 'cursor',
): {
  items: T[];
  next: string | null;
} {
  const start = Number(request.query[cursorName] ?? 0) || 0;
  const slice = items.slice(start, start + pageSize);
  return { items: slice, next: start + pageSize < items.length ? String(start + pageSize) : null };
}
