// The Outlook task pane: pair once with a code from OpenNote, then save the open message to a section. The
// pairing token stays in this add-in's own storage on this PC and only ever goes to 127.0.0.1. The build copies
// the clipper's shared modules beside this file (extensions/build.mjs).

import { ApiError, connect, pair, parseCode, parsePort, sectionChoices } from './shared/api.js';
import { messageToPage } from './shared/mail.js';
import { toMarkdown } from './shared/markdown.js';
import { itemToMessage, outlookLink } from './lib/outlook.js';

const $ = (id) => document.getElementById(id);
const status = (text) => {
  $('status').textContent = text;
};

const store = {
  get(key) {
    try {
      return localStorage.getItem(`opennote.${key}`);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(`opennote.${key}`);
      else localStorage.setItem(`opennote.${key}`, String(value));
    } catch {
      // Storage is off; the person pairs again next time.
    }
  },
};

const call = (start) =>
  new Promise((resolve) => {
    start((result) => resolve(result.status === Office.AsyncResultStatus.Succeeded ? result.value : null));
  });

async function readItem(withFiles) {
  const item = Office.context.mailbox.item;
  const html = (await call((done) => item.body.getAsync(Office.CoercionType.Html, done))) ?? '';
  const markdown = html ? toMarkdown(new DOMParser().parseFromString(html, 'text/html').body, undefined) : '';
  const attachments = [];
  for (const each of withFiles ? (item.attachments ?? []) : []) {
    const content = each.isInline ? null : await call((done) => item.getAttachmentContentAsync(each.id, done));
    attachments.push({ ...each, content });
  }
  let restId;
  try {
    restId = Office.context.mailbox.convertToRestId(item.itemId, Office.MailboxEnums.RestVersion.v2_0);
  } catch {
    restId = null;
  }
  return itemToMessage({
    subject: item.subject,
    from: item.from,
    to: item.to,
    dateTimeCreated: item.dateTimeCreated,
    markdown,
    link: outlookLink(Office.context.mailbox.restUrl, restId),
    attachments,
  });
}

function explain(error) {
  if (error instanceof ApiError && error.status === 401) {
    store.set('token', null);
    status('This pairing was removed in OpenNote. Pair again.');
    showPair();
    return;
  }
  status(error instanceof ApiError ? error.message : 'Something went wrong. Nothing was saved.');
}

function showPair() {
  $('save').hidden = true;
  $('pair').hidden = false;
  const port = store.get('port');
  if (port) $('port').value = port;
  $(port ? 'code' : 'port').focus();
}

async function showSave() {
  $('pair').hidden = true;
  $('save').hidden = false;
  const select = $('section');
  select.replaceChildren();
  status('Loading your sections…');
  try {
    const choices = await sectionChoices(connect(store.get('port'), store.get('token')));
    for (const choice of choices) {
      const option = new Option(choice.locked ? `${choice.label} (locked)` : choice.label, choice.id);
      option.disabled = choice.locked;
      select.append(option);
    }
    const saved = choices.find((choice) => choice.id === store.get('section') && !choice.locked);
    const first = choices.find((choice) => !choice.locked);
    if (saved ?? first) select.value = (saved ?? first).id;
    $('go').disabled = !first;
    status(first ? '' : 'OpenNote has no section this add-in may add to.');
  } catch (error) {
    explain(error);
  }
}

Office.onReady(() => {
  if (store.get('token') && store.get('port')) void showSave();
  else showPair();

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
      const { token } = await pair({ port, code, name: 'Outlook', kind: 'mail' });
      store.set('port', port);
      store.set('token', token);
      $('code').value = '';
      await showSave();
    } catch (error) {
      explain(error);
    }
  });

  $('save').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('go').disabled = true;
    status('Saving…');
    try {
      const { page, skipped } = messageToPage(await readItem($('files').checked));
      const section = $('section').value;
      await connect(store.get('port'), store.get('token')).createPage(section, page);
      store.set('section', section);
      status(skipped.length ? `Saved. ${skipped.length} attachment(s) stayed behind.` : 'Saved to OpenNote.');
    } catch (error) {
      explain(error);
    } finally {
      $('go').disabled = false;
    }
  });

  $('unpair').addEventListener('click', () => {
    store.set('token', null);
    status('Pairing forgotten. Remove it in OpenNote’s App permissions too.');
    showPair();
  });
});
