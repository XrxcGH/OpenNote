// "Save to OpenNote" for an email, from Outlook (extensions/outlook-addin) or Gmail (the clipper): one message
// becomes one page. The title is the subject, a few lines at the top say who sent it and when, the body follows as
// Markdown, files come along as attachments, and the page keeps a link back to the message.

import { LIMITS, isWebUrl } from './api.js';

/** Attachments OpenNote leaves behind, and why, so the page can say so instead of dropping them quietly. */
export const SKIPPED = Object.freeze({ tooLarge: 'tooLarge', tooMany: 'tooMany', notFile: 'notFile' });

function line(text) {
  return String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function escape(text) {
  return line(text).replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

function person({ name, email } = {}) {
  const cleanName = escape(name);
  const cleanEmail = escape(email);
  if (cleanName && cleanEmail && cleanName !== cleanEmail) return `${cleanName} (${cleanEmail})`;
  return cleanName || cleanEmail;
}

/**
 * A message as a page body for the local API.
 *
 * `message` is `{ subject, from: { name, email }, to: [{ name, email }], date: Date | string, markdown, link,
 * attachments: [{ name, mime, size, data (base64) | null, inline }] }`.
 * Resolves to `{ page, skipped: [{ name, reason }] }`.
 */
export function messageToPage(message) {
  const title = line(message.subject).slice(0, LIMITS.title) || 'Email without a subject';
  const lines = [];
  const from = person(message.from);
  if (from) lines.push(`**From:** ${from}`);
  const to = (message.to ?? []).map(person).filter(Boolean);
  if (to.length) lines.push(`**To:** ${to.slice(0, 10).join(', ')}${to.length > 10 ? ', …' : ''}`);
  const date = message.date ? new Date(message.date) : null;
  if (date && !Number.isNaN(date.getTime()))
    lines.push(`**Sent:** ${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  const link = isWebUrl(message.link) ? message.link : null;
  if (link) lines.push(`[Open the message](${link.replace(/\)/g, '%29')})`);
  const attachments = [];
  const skipped = [];
  for (const file of message.attachments ?? []) {
    const name = line(file.name) || 'attachment';
    if (file.inline || !file.data) {
      if (!file.inline) skipped.push({ name, reason: SKIPPED.notFile });
      continue;
    }
    if ((file.size ?? (file.data.length * 3) / 4) > LIMITS.attachment) {
      skipped.push({ name, reason: SKIPPED.tooLarge });
      continue;
    }
    if (attachments.length === LIMITS.attachments) {
      skipped.push({ name, reason: SKIPPED.tooMany });
      continue;
    }
    attachments.push({ name, mime: cleanMime(file.mime), data: file.data });
  }
  if (skipped.length) {
    lines.push(`_Not attached: ${skipped.map((each) => escape(each.name)).join(', ')}._`);
  }
  const body = String(message.markdown ?? '').trim();
  const markdown = [lines.join('  \n'), body].filter(Boolean).join('\n\n---\n\n');
  const page = { title, markdown, attachments };
  if (link) page.sourceUrl = link;
  return { page, skipped };
}

/** The MIME type the API accepts, or a plain binary one. */
export function cleanMime(mime) {
  const value = String(mime ?? '')
    .trim()
    .toLowerCase()
    .split(';')[0];
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value) && value.length <= 100 ? value : 'application/octet-stream';
}

/**
 * Gmail lists each attachment with a `download_url` attribute of `mime:name:url`. The URL itself has colons, so
 * only the first two split it. Only Gmail's own addresses are kept.
 */
export function parseGmailDownload(value) {
  const text = String(value ?? '');
  const first = text.indexOf(':');
  const second = first < 0 ? -1 : text.indexOf(':', first + 1);
  if (second < 0) return null;
  const mime = cleanMime(text.slice(0, first));
  const name = line(text.slice(first + 1, second));
  const url = text.slice(second + 1);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'mail.google.com') return null;
  } catch {
    return null;
  }
  return name ? { mime, name, url } : null;
}
