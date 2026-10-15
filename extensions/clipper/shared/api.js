// OpenNote's local API as the browser clipper and the Outlook add-in use it (docs/help/local-api.md). Both talk
// only to 127.0.0.1 on the port the person read from OpenNote, pair once with a code the person made in
// App permissions, and then send new pages with the token they got. The token stays in this extension's own
// storage and is never shown, logged, or sent anywhere but 127.0.0.1.

/** The kinds of app that pair with a code (crates/api/src/routes.rs, pair_code). */
export const KINDS = ['clipper', 'mail'];

/** Limits the API enforces (crates/api/src/routes.rs); checked here too so a clip fails early and plainly. */
export const LIMITS = Object.freeze({
  title: 200,
  markdown: 2 * 1024 * 1024,
  attachments: 10,
  attachment: 15 * 1024 * 1024,
  url: 2048,
});

/** An answer from the API that isn't a success, with the API's own short code. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** A port the person typed: a whole number OpenNote could listen on. */
export function parsePort(text) {
  const value = String(text ?? '').trim();
  if (!/^\d{4,5}$/.test(value)) return null;
  const port = Number(value);
  return port >= 1024 && port <= 65535 ? port : null;
}

/** A pairing code as the person typed it: eight letters and digits, case and spaces, and the dash ignored. */
export function parseCode(text) {
  const plain = String(text ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  return /^[A-Z0-9]{8}$/.test(plain) ? `${plain.slice(0, 4)}-${plain.slice(4)}` : null;
}

/** The API's address on this PC. Only ever 127.0.0.1. */
export function baseUrl(port) {
  if (parsePort(port) === null) throw new ApiError(0, 'port', 'That port number is not valid.');
  return `http://127.0.0.1:${port}/v1`;
}

async function send(fetcher, url, init) {
  let response;
  try {
    response = await fetcher(url, { ...init, credentials: 'omit', cache: 'no-store', redirect: 'error' });
  } catch {
    throw new ApiError(0, 'offline', 'OpenNote isn’t running, or it isn’t letting apps connect.');
  }
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? 'failed', body?.message ?? 'OpenNote couldn’t do that.');
  }
  return body;
}

/** Pairs with a code. Resolves with `{ token, app }`. */
export async function pair({ port, code, name, kind }, fetcher = fetch) {
  const clean = parseCode(code);
  if (!clean) throw new ApiError(0, 'code', 'A pairing code has eight letters and digits.');
  if (!KINDS.includes(kind)) throw new ApiError(0, 'kind', 'Unknown kind of app.');
  return send(fetcher, `${baseUrl(port)}/pair/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: clean, name: String(name).slice(0, 80), kind }),
  });
}

/** A connection: the port and the token. */
export function connect(port, token, fetcher = fetch) {
  const base = baseUrl(port);
  if (typeof token !== 'string' || token.length < 16) throw new ApiError(0, 'token', 'Pair with OpenNote first.');
  const auth = { authorization: `Bearer ${token}` };
  return {
    me: () => send(fetcher, `${base}/me`, { headers: auth }),
    notebooks: async () => (await send(fetcher, `${base}/notebooks`, { headers: auth })).notebooks,
    sections: async (notebook) =>
      (await send(fetcher, `${base}/notebooks/${encodeURIComponent(notebook)}/sections`, { headers: auth })).sections,
    createPage: async (section, page) =>
      (
        await send(fetcher, `${base}/sections/${encodeURIComponent(section)}/pages`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify(checkPage(page)),
        })
      ).page,
  };
}

/** Every section the grant may add to, as `{ id, label, locked }`, notebook first, for a section picker. */
export async function sectionChoices(connection) {
  const choices = [];
  for (const notebook of await connection.notebooks()) {
    for (const section of await connection.sections(notebook.id)) {
      choices.push({
        id: section.id,
        label: `${notebook.title} › ${section.title}`,
        locked: Boolean(section.locked),
      });
    }
  }
  return choices;
}

/** Checks a page body against the API's limits, trimming the title. Throws an ApiError when it can't be sent. */
export function checkPage(page) {
  const title = String(page.title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.title);
  if (!title) throw new ApiError(0, 'title', 'A page needs a title.');
  const markdown = String(page.markdown ?? '');
  if (new TextEncoder().encode(markdown).length > LIMITS.markdown) {
    throw new ApiError(0, 'markdown', 'This is too long to clip. Try a clean article or a region instead.');
  }
  const out = { title, markdown };
  if (page.sourceUrl && isWebUrl(page.sourceUrl)) out.sourceUrl = page.sourceUrl;
  const attachments = page.attachments ?? [];
  if (attachments.length > LIMITS.attachments) throw new ApiError(0, 'attachments', 'At most 10 attachments.');
  for (const each of attachments) {
    if (each.data.length > Math.ceil(LIMITS.attachment / 3) * 4) {
      throw new ApiError(0, 'attachments', `“${each.name}” is larger than 15 MB.`);
    }
  }
  if (attachments.length) out.attachments = attachments;
  return out;
}

/** Whether the API keeps this as a page's source: http or https, one line, at most 2048 characters. */
export function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url) && url.length <= LIMITS.url;
}

/** Bytes as base64, in pieces so large pictures don't overflow the call stack. */
export function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (let at = 0; at < view.length; at += 0x8000) {
    text += String.fromCharCode(...view.subarray(at, at + 0x8000));
  }
  return btoa(text);
}
