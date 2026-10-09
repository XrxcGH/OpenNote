import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ApiError,
  LIMITS,
  checkPage,
  connect,
  pair,
  parseCode,
  parsePort,
  sectionChoices,
  toBase64,
} from '../clipper/shared/api.js';

// A token-shaped test value, built from pieces so it never reads as a real one.
const TOKEN = ['test', 'token', 'value', 'only'].join('-');

function fakeFetch(replies) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetcher, calls };
}

test('reads ports and pairing codes the way people type them', () => {
  assert.equal(parsePort(' 49213 '), 49213);
  for (const bad of ['', '80', '70000', '12a45', '-1', '1e4']) assert.equal(parsePort(bad), null, bad);
  assert.equal(parseCode('abcd efgh'), 'ABCD-EFGH');
  assert.equal(parseCode('ABCD-EFGH'), 'ABCD-EFGH');
  assert.equal(parseCode('ABC'), null);
  assert.equal(parseCode('ABCD-EFGH-J'), null);
});

test('pairs with a code, only ever on 127.0.0.1, without cookies', async () => {
  const { fetcher, calls } = fakeFetch([{ body: { token: TOKEN, app: { id: 'a1' } } }]);
  const result = await pair({ port: 49213, code: 'abcdefgh', name: 'Web clipper', kind: 'clipper' }, fetcher);
  assert.equal(result.token, TOKEN);
  assert.equal(calls[0].url, 'http://127.0.0.1:49213/v1/pair/code');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: 'ABCD-EFGH', name: 'Web clipper', kind: 'clipper' });
  await assert.rejects(pair({ port: 49213, code: 'x', name: 'n', kind: 'clipper' }, fetcher), { code: 'code' });
  await assert.rejects(pair({ port: 49213, code: 'abcdefgh', name: 'n', kind: 'cli' }, fetcher), { code: 'kind' });
});

test('says plainly when OpenNote is not running, and passes on the API refusals', async () => {
  const { fetcher } = fakeFetch([
    new TypeError('Failed to fetch'),
    { status: 401, body: { error: 'token', message: 'Connect it again.' } },
  ]);
  const api = connect(49213, TOKEN, fetcher);
  await assert.rejects(api.notebooks(), (error) => error instanceof ApiError && error.code === 'offline');
  await assert.rejects(api.notebooks(), (error) => error.status === 401 && error.message === 'Connect it again.');
});

test('lists sections for the picker, notebook first, and marks locked ones', async () => {
  const { fetcher, calls } = fakeFetch([
    { body: { notebooks: [{ id: 'n1', title: 'School' }] } },
    {
      body: {
        sections: [
          { id: 's1', notebookId: 'n1', title: 'Biology', locked: false },
          { id: 's2', notebookId: 'n1', title: 'Diary', locked: true },
        ],
      },
    },
  ]);
  const choices = await sectionChoices(connect(49213, TOKEN, fetcher));
  assert.deepEqual(choices, [
    { id: 's1', label: 'School › Biology', locked: false },
    { id: 's2', label: 'School › Diary', locked: true },
  ]);
  assert.equal(calls[1].url, 'http://127.0.0.1:49213/v1/notebooks/n1/sections');
  assert.equal(calls[1].init.headers.authorization, `Bearer ${TOKEN}`);
});

test('creates a page with the source, and checks limits before sending', async () => {
  const { fetcher, calls } = fakeFetch([{ status: 201, body: { page: { id: 'p1' } } }]);
  const page = await connect(49213, TOKEN, fetcher).createPage('s 1', {
    title: '  A   story ',
    markdown: 'Text',
    sourceUrl: 'https://example.org/story',
  });
  assert.deepEqual(page, { id: 'p1' });
  assert.equal(calls[0].url, 'http://127.0.0.1:49213/v1/sections/s%201/pages');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    title: 'A story',
    markdown: 'Text',
    sourceUrl: 'https://example.org/story',
  });
  assert.equal(checkPage({ title: 'x', sourceUrl: 'javascript:alert(1)' }).sourceUrl, undefined);
  assert.throws(() => checkPage({ title: ' ' }), { code: 'title' });
  assert.throws(() => checkPage({ title: 'x', markdown: 'a'.repeat(LIMITS.markdown + 1) }), { code: 'markdown' });
  const many = Array.from({ length: 11 }, (_, at) => ({ name: `${at}`, mime: 'text/plain', data: 'QQ==' }));
  assert.throws(() => checkPage({ title: 'x', attachments: many }), { code: 'attachments' });
  assert.throws(() => connect(80, TOKEN), { code: 'port' });
  assert.throws(() => connect(49213, ''), { code: 'token' });
});

test('encodes large pictures as base64 without overflowing', () => {
  const bytes = new Uint8Array(200_000).map((_, at) => at % 251);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
});
