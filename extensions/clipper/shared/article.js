// "Clean article": finds the main text of a web page and leaves out menus, ads, comments, and sidebars, in the
// manner of Mozilla's Readability. It scores each block by the paragraphs it holds, how much text they have, and
// how few links, then keeps the best one and the siblings that score close to it. It works on a copy, so the page
// the person is reading never changes.

import { toMarkdown } from './markdown.js';

const UNLIKELY = new RegExp(
  [
    'banner|breadcrumb|combx|comment|community|cookie|disqus|footer|header|menu|modal|nav',
    'newsletter|outbrain|popup|promo|related|remark|replies|rss|share|shoutbox|sidebar',
    'skyscraper|social|sponsor|subscribe|taboola|tool|widget|\bad-|\bads\b',
  ].join('|'),
  'i',
);
const LIKELY = /and|article|body|column|content|main|post|story|text|entry|shadow/i;
const POSITIVE = /article|body|content|entry|main|page|post|story|text|blog/i;
const NEGATIVE =
  /comment|contact|footer|footnote|hidden|masthead|meta|outbrain|promo|related|scroll|share|sidebar|sponsor|shopping|tag|tool|widget/i;
const DROP = 'script,style,noscript,template,iframe,form,button,input,select,textarea,nav,aside,footer,dialog,svg';

function classWeight(element) {
  const text = `${element.className ?? ''} ${element.id ?? ''}`;
  let weight = 0;
  if (POSITIVE.test(text)) weight += 25;
  if (NEGATIVE.test(text)) weight -= 25;
  return weight;
}

function linkDensity(element) {
  const total = (element.textContent ?? '').length || 1;
  let linked = 0;
  for (const link of element.querySelectorAll('a')) linked += (link.textContent ?? '').length;
  return linked / total;
}

/** The page's title without the site's name tacked on, such as "Story | The Paper". */
export function articleTitle(doc) {
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
  if (og) return og;
  const raw = (doc.title ?? '').trim();
  const parts = raw.split(/\s[|\-–—»:]\s/);
  if (parts.length > 1 && parts[0].split(/\s+/).length >= 3) return parts[0].trim();
  return raw || doc.querySelector('h1')?.textContent?.trim() || '';
}

/** The element that holds the article, on a cleaned copy of the document, or null when nothing reads like one. */
export function findArticle(doc) {
  const copy = doc.cloneNode(true);
  const body = copy.body;
  if (!body) return null;
  for (const element of body.querySelectorAll(DROP)) element.remove();
  for (const element of [...body.querySelectorAll('*')]) {
    const tag = element.tagName;
    if (tag === 'BODY' || tag === 'ARTICLE' || tag === 'MAIN') continue;
    const name = `${element.className ?? ''} ${element.id ?? ''}`;
    if (UNLIKELY.test(name) && !LIKELY.test(name) && !element.querySelector('article, main')) element.remove();
  }
  const scores = new Map();
  const add = (element, score) => {
    if (!element || element === copy.documentElement) return;
    if (!scores.has(element)) scores.set(element, classWeight(element) + (element.tagName === 'ARTICLE' ? 10 : 0));
    scores.set(element, scores.get(element) + score);
  };
  for (const paragraph of body.querySelectorAll('p, pre, td, blockquote')) {
    const text = (paragraph.textContent ?? '').trim();
    if (text.length < 25) continue;
    const score = 1 + text.split(/[,،，]/).length + Math.min(Math.floor(text.length / 100), 3);
    add(paragraph.parentElement, score);
    add(paragraph.parentElement?.parentElement, score / 2);
  }
  let best = null;
  let bestScore = 0;
  for (const [element, score] of scores) {
    const adjusted = score * (1 - linkDensity(element));
    scores.set(element, adjusted);
    if (adjusted > bestScore) {
      best = element;
      bestScore = adjusted;
    }
  }
  if (!best) {
    const fallback = body.querySelector('article, main, [role="main"]');
    return fallback && (fallback.textContent ?? '').trim().length > 140 ? fallback : null;
  }
  const holder = copy.createElement('div');
  const threshold = Math.max(10, bestScore * 0.2);
  const siblings = best.parentElement ? [...best.parentElement.children] : [best];
  for (const sibling of siblings) {
    const score = scores.get(sibling) ?? 0;
    const text = (sibling.textContent ?? '').trim();
    const keep =
      sibling === best ||
      score >= threshold ||
      (sibling.tagName === 'P' && text.length > 80 && linkDensity(sibling) < 0.25);
    if (keep) holder.appendChild(sibling.cloneNode(true));
  }
  for (const element of [...holder.querySelectorAll('*')]) {
    if (element.tagName === 'IMG' || element.querySelector('img, pre, table')) continue;
    const text = (element.textContent ?? '').trim();
    if (!text && !/^(BR|HR)$/.test(element.tagName)) element.remove();
    else if (/^(DIV|SECTION|UL|OL)$/.test(element.tagName) && text.length < 200 && linkDensity(element) > 0.5) {
      element.remove();
    }
  }
  return holder;
}

/** The article as `{ title, markdown }`, or null when the page has no article to find. */
export function extractArticle(doc, base) {
  const holder = findArticle(doc);
  if (!holder) return null;
  const markdown = toMarkdown(holder, base);
  if (markdown.length < 80) return null;
  const title = articleTitle(doc);
  const firstLine = markdown.split('\n', 1)[0].replace(/^#+\s*/, '');
  return { title, markdown: firstLine === title ? markdown.slice(markdown.indexOf('\n') + 1).trim() : markdown };
}
