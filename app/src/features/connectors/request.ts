// A typed way for a feature to call a service. `requestConnector` builds the address from a path and a query,
// writes a JSON or form body, and reads a JSON answer, so a feature says what it wants and gets a typed value. The
// host adds the token (a feature never sees one). A status outside 200 to 299 throws a ConnectorHttpError that holds
// the status and the service's own words, unless the caller lists it in `accept`.

import type { ConnectorsClient } from './client';
import { connectors } from './runtime';
import type { ConnectorRequest, ConnectorResponse } from './types';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: ConnectorRequest['method'];
  /** A full address, or a path that follows `base`. */
  url: string;
  /** The address a path follows, such as `https://graph.microsoft.com/v1.0`. */
  base?: string;
  /** Added to the address; a value of null or undefined is left out. */
  query?: Readonly<Record<string, QueryValue>>;
  /** Sent as a JSON body. */
  json?: unknown;
  /** Sent as form fields. */
  form?: Readonly<Record<string, string>>;
  headers?: Readonly<Record<string, string>>;
  /** Statuses that are an answer and not a failure, such as 404 when a missing thing is a normal case. */
  accept?: readonly number[];
}

export interface ConnectorReply<T> {
  status: number;
  contentType: string | null;
  /** The body as text. */
  text: string;
  /** The body read as JSON, or undefined when it is empty or is not JSON. */
  data: T | undefined;
}

/** The service answered, but not with success. `body` is its own words and never holds a token. */
export class ConnectorHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`The service answered ${status}.`);
    this.name = 'ConnectorHttpError';
    this.status = status;
    this.body = body;
  }
}

/** The address of a request: `url` as given, or joined to `base`, with the query encoded and no empty values. */
export function buildUrl(options: Pick<RequestOptions, 'url' | 'base' | 'query'>): string {
  const joined = /^https?:\/\//i.test(options.url)
    ? options.url
    : `${(options.base ?? '').replace(/\/+$/, '')}/${options.url.replace(/^\/+/, '')}`;
  const pairs = Object.entries(options.query ?? {}).filter(
    (pair): pair is [string, string | number | boolean] => pair[1] !== null && pair[1] !== undefined,
  );
  if (pairs.length === 0) return joined;
  const query = new URLSearchParams(pairs.map(([key, value]) => [key, String(value)])).toString();
  return `${joined}${joined.includes('?') ? '&' : '?'}${query}`;
}

function parseJson<T>(text: string): T | undefined {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** The request the host receives for these options. Exported so a test can check what a feature sends. */
export function toRequest(options: RequestOptions): ConnectorRequest {
  const request: ConnectorRequest = {
    method: options.method ?? (options.json !== undefined || options.form ? 'POST' : 'GET'),
    url: buildUrl(options),
  };
  const headers = { ...options.headers };
  if (options.json !== undefined) {
    request.body = JSON.stringify(options.json);
    request.contentType = 'application/json';
  } else if (options.form) {
    request.form = { ...options.form };
  }
  if (!headers.Accept && !headers.accept) headers.Accept = 'application/json';
  request.headers = headers;
  return request;
}

/**
 * Sends the request with the connection's token. `access` names what it needs, such as `calendarRead`. Rejects with
 * a ConnectorError when the host refuses (not connected, offline, and so on) and a ConnectorHttpError when the
 * service answers with a failure.
 */
export async function requestConnector<T = unknown>(
  id: string,
  access: readonly string[],
  options: RequestOptions,
  client: ConnectorsClient = connectors(),
): Promise<ConnectorReply<T>> {
  const response: ConnectorResponse = await client.request(id, access, toRequest(options));
  const ok = response.status >= 200 && response.status < 300;
  if (!ok && !options.accept?.includes(response.status)) throw new ConnectorHttpError(response.status, response.body);
  return {
    status: response.status,
    contentType: response.contentType,
    text: response.body,
    data: parseJson<T>(response.body),
  };
}
