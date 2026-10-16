// What each kind of clip becomes: a page body for the local API ({ title, markdown, sourceUrl, attachments }).
// `parse` turns HTML into a Document (DOMParser in the browser, jsdom in the tests); nothing here runs the page's
// scripts or loads its pictures.

import { extractArticle } from '../shared/article.js';
import { messageToPage, parseGmailDownload } from '../shared/mail.js';
import { toMarkdown } from '../shared/markdown.js';

export const MODES = ['article', 'page', 'region'];

function titleOf(page) {
  return String(page.title ?? '').trim() || new URL(page.url).hostname;
}

/** The whole page as Markdown. A selection, when there is one, goes first as a quote. */
export function pageClip(page, parse) {
  const doc = parse(page.html);
  const markdown = toMarkdown(doc.body ?? doc.documentElement, page.url);
  const selection = String(page.selection ?? '').trim();
  const quote = selection ? `${selection.replace(/^/gm, '> ')}\n\n` : '';
  return { title: titleOf(page), markdown: `${quote}${markdown}`, sourceUrl: page.url };
}

/** The main text only. A page with no article to find is clipped whole, and `fellBack` says so. */
export function articleClip(page, parse) {
  const article = extractArticle(parse(page.html), page.url);
  if (!article) return { ...pageClip(page, parse), fellBack: true };
  return { title: article.title || titleOf(page), markdown: article.markdown, sourceUrl: page.url };
}

/** A screenshot of a region, as a picture on the page. */
export function regionClip(page, pngBase64) {
  return {
    title: titleOf(page),
    markdown: '',
    sourceUrl: page.url,
    attachments: [{ name: 'Clip.png', mime: 'image/png', data: pngBase64 }],
  };
}

/** The Gmail attachments worth fetching: Gmail's own download addresses, at most ten. */
export function gmailDownloads(message) {
  return (message.downloads ?? []).map(parseGmailDownload).filter(Boolean).slice(0, 10);
}

/** An open Gmail message, with the files that were fetched, as a page. */
export function gmailClip(message, parse, files) {
  const body = message.html ? toMarkdown(parse(message.html).body, message.link) : '';
  return messageToPage({
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date || null,
    markdown: body,
    link: message.link,
    attachments: files,
  });
}
