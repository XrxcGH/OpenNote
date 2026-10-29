// The clipper's window: pair once with a code from OpenNote, then pick what to clip and the section it goes in.
// The page is read and turned into Markdown here; a region screenshot is handed to the background script, because
// this window closes while the person drags over the page.

import { ApiError, connect, pair, parseCode, parsePort, sectionChoices, toBase64 } from './shared/api.js';
import { articleClip, gmailClip, gmailDownloads, pageClip } from './lib/clip.js';
import { clipLink } from './lib/deeplink.js';
import { readGmail, readPage } from './lib/inject.js';

const GMAIL_HOSTS = ['https://mail.google.com/*', 'https://mail-attachment.googleusercontent.com/*'];
const $ = (id) => document.getElementById(id);
const status = (text) => {
  $('status').textContent = text;
};

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

async function stored() {
  try {
    return await chrome.storage.local.get(['port', 'token', 'section']);
  } catch {
    return {};
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function inPage(tab, func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return result?.result ?? null;
}

function sendLink(tab) {
  const link = clipLink(tab.url, tab.title);
  if (!link) {
    status('This page can’t be sent as a link. Open OpenNote and try again.');
    return;
  }
  status('Sending the address to OpenNote instead.');
  void chrome.tabs.update(tab.id, { url: link });
}

function explain(error, tab) {
  if (error instanceof ApiError && error.code === 'offline') {
    status('OpenNote isn’t reachable. Open it, and in App permissions let apps on this PC connect.');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet';
    button.textContent = 'Send just the address';
    button.addEventListener('click', () => sendLink(tab));
    $('status').append(document.createElement('br'), button);
    return;
  }
  if (error instanceof ApiError && error.status === 401) {
    void chrome.storage.local.remove(['token']);
    status('This pairing was removed in OpenNote. Pair again.');
    void showPair();
    return;
  }
  status(error instanceof ApiError ? error.message : 'Something went wrong. Nothing was saved.');
}

async function showPair() {
  $('clip').hidden = true;
  $('pair').hidden = false;
  const { port } = await stored();
  if (port) $('port').value = String(port);
  $(port ? 'code' : 'port').focus();
}

async function showClip(tab, saved) {
  $('pair').hidden = true;
  $('clip').hidden = false;
  $('title').value = tab.title ?? '';
  const onGmail = /^https:\/\/mail\.google\.com\//.test(tab.url ?? '');
  $('mail-choice').hidden = !onGmail;
  if (onGmail) document.querySelector('input[value="gmail"]').checked = true;
  const select = $('section');
  select.replaceChildren();
  status('Loading your sections…');
  try {
    const choices = await sectionChoices(connect(saved.port, saved.token));
    for (const choice of choices) {
      const option = new Option(choice.locked ? `${choice.label} (locked)` : choice.label, choice.id);
      option.disabled = choice.locked;
      select.append(option);
    }
    const remembered = choices.find((choice) => choice.id === saved.section && !choice.locked);
    const first = choices.find((choice) => !choice.locked);
    if (remembered ?? first) select.value = (remembered ?? first).id;
    status(first ? '' : 'OpenNote has no section this clipper may add to.');
    $('go').disabled = !first;
  } catch (error) {
    explain(error, tab);
  }
}

async function clip(tab, saved, mode, section, title) {
  const api = connect(saved.port, saved.token);
  if (mode === 'region') {
    await chrome.runtime.sendMessage({ kind: 'region', tabId: tab.id, section, title });
    window.close();
    return;
  }
  status('Clipping…');
  let page;
  let note = '';
  if (mode === 'gmail') {
    const message = await inPage(tab, readGmail);
    if (!message) throw new ApiError(0, 'gmail', 'Open one email in Gmail first.');
    const files = [];
    for (const file of gmailDownloads(message)) {
      try {
        const response = await fetch(file.url, { credentials: 'include' });
        const bytes = new Uint8Array(await response.arrayBuffer());
        files.push({
          name: file.name,
          mime: file.mime,
          size: bytes.length,
          data: response.ok ? toBase64(bytes) : null,
        });
      } catch {
        files.push({ name: file.name, mime: file.mime, data: null });
      }
    }
    const mapped = gmailClip(message, parse, files);
    page = mapped.page;
    if (mapped.skipped.length) note = ` ${mapped.skipped.length} attachment(s) stayed behind.`;
  } else {
    const content = await inPage(tab, readPage);
    if (!content) throw new ApiError(0, 'page', 'This page can’t be clipped.');
    page = mode === 'page' ? pageClip(content, parse) : articleClip(content, parse);
    if (page.fellBack) note = ' There was no article to find, so the whole page was clipped.';
    delete page.fellBack;
  }
  if (title.trim()) page.title = title;
  await api.createPage(section, page);
  await chrome.storage.local.set({ section });
  status(`Saved to OpenNote.${note}`);
}

async function main() {
  const tab = await activeTab();
  const saved = await stored();
  if (saved.token && saved.port) await showClip(tab, saved);
  else await showPair();

  $('pair').addEventListener('submit', async (event) => {
    event.preventDefault();
    const port = parsePort($('port').value);
    const code = parseCode($('code').value);
    if (!port || !code) {
      status(!port ? 'Type the port number OpenNote shows.' : 'A pairing code has eight letters and digits.');
      return;
    }
    status('Pairing…');
    try {
      const { token } = await pair({ port, code, name: 'Web clipper', kind: 'clipper' });
      await chrome.storage.local.set({ port, token });
      $('code').value = '';
      await showClip(tab, { port, token });
    } catch (error) {
      explain(error, tab);
    }
  });

  $('clip').addEventListener('submit', (event) => {
    event.preventDefault();
    const mode = new FormData($('clip')).get('mode');
    // Gmail's addresses are asked for only when the person first saves an email, and only in this click.
    const asked = mode === 'gmail' ? chrome.permissions.request({ origins: GMAIL_HOSTS }) : Promise.resolve(true);
    $('go').disabled = true;
    void asked
      .then(async (granted) => {
        if (!granted) throw new ApiError(0, 'permission', 'Saving an email needs access to Gmail’s pages.');
        const current = await stored();
        await clip(tab, current, mode, $('section').value, $('title').value);
      })
      .catch((error) => explain(error, tab))
      .finally(() => {
        $('go').disabled = false;
      });
  });

  $('unpair').addEventListener('click', async () => {
    await chrome.storage.local.remove(['token', 'section']);
    status('Pairing forgotten. Remove it in OpenNote’s App permissions too.');
    await showPair();
  });
}

void main();
