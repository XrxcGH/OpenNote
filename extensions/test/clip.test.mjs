import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';

import { articleClip, gmailClip, gmailDownloads, pageClip, regionClip } from '../clipper/lib/clip.js';
import { clipLink } from '../clipper/lib/deeplink.js';
import { cropBox } from '../clipper/lib/region.js';
import { articleTitle } from '../clipper/shared/article.js';
import { safeUrl, toMarkdown } from '../clipper/shared/markdown.js';

const parse = (html) => new JSDOM(html).window.document;
const URL_ = 'https://example.org/news/story';

const ARTICLE = `<!doctype html><html><head><title>Rivers in spring | The Example Paper</title></head><body>
<nav class="menu"><a href="/">Home</a><a href="/news">News</a><a href="/sport">Sport</a></nav>
<div class="sidebar"><a href="/a">Most read one</a><a href="/b">Most read two</a></div>
<article class="post-content">
  <h1>Rivers in spring</h1>
  <p>Rivers rise in spring when the snow melts in the hills, and the water carries soil, leaves, and branches down to the valley floor.</p>
  <p>Farmers along the banks watch the level each morning, because a quick rise can flood the low fields,
  and a slow one waters them well.</p>
  <p>Older people in the valley remember the year the bridge was closed for a week, and the ferry that ran in its place.</p>
  <script>alert('no')</script>
</article>
<div class="comments"><p>First! This is a comment that nobody needs in their notes at all, thank you.</p></div>
<footer>Copyright</footer>
</body></html>`;

test('turns a page into Markdown, keeping only safe links', () => {
  const doc = parse(`<body><h2>Title</h2><p>Some <b>bold</b> and <a href="/x">a link</a>
    <a href="javascript:alert(1)">bad</a> <img src="pic.png" alt="A pic"></p>
    <ul><li>One<ul><li>Inner</li></ul></li><li>Two</li></ul><ol start="3"><li>Three</li></ol>
    <pre>let x = 1;</pre><blockquote><p>Quoted</p></blockquote>
    <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2|3</td></tr></table>
    <form><input value="secret"></form><div hidden>Hidden</div></body>`);
  const markdown = toMarkdown(doc.body, URL_);
  assert.match(markdown, /^## Title/);
  assert.match(markdown, /Some \*\*bold\*\* and \[a link\]\(https:\/\/example\.org\/x\)/);
  assert.match(markdown, / bad /);
  assert.doesNotMatch(markdown, /javascript:/);
  assert.match(markdown, /!\[A pic\]\(https:\/\/example\.org\/news\/pic\.png\)/);
  assert.match(markdown, /- One\n {2}- Inner\n- Two/);
  assert.match(markdown, /3\. Three/);
  assert.match(markdown, /```\nlet x = 1;\n```/);
  assert.match(markdown, /> Quoted/);
  assert.match(markdown, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2\\\|3 \|/);
  assert.doesNotMatch(markdown, /secret|Hidden/);
  assert.equal(safeUrl('data:text/html,x', URL_), null);
  assert.equal(safeUrl('mailto:a@example.org', URL_), 'mailto:a@example.org');
});

test('a clean article leaves out menus, sidebars, comments, and scripts', () => {
  const clip = articleClip({ url: URL_, title: 'Rivers in spring | The Example Paper', html: ARTICLE }, parse);
  assert.equal(clip.title, 'Rivers in spring');
  assert.equal(clip.sourceUrl, URL_);
  assert.equal(clip.fellBack, undefined);
  assert.match(clip.markdown, /Rivers rise in spring/);
  assert.match(clip.markdown, /ferry that ran/);
  for (const noise of ['Most read', 'Home', 'First!', 'Copyright', 'alert']) {
    assert.doesNotMatch(clip.markdown, new RegExp(noise), noise);
  }
});

test('a page with no article is clipped whole, and says so', () => {
  const clip = articleClip({ url: URL_, title: 'Tiny', html: '<body><p>Hi</p></body>' }, parse);
  assert.equal(clip.fellBack, true);
  assert.equal(clip.markdown, 'Hi');
});

test('a full page clip quotes the selection first', () => {
  const clip = pageClip(
    { url: URL_, title: '', html: '<body><p>Body text</p></body>', selection: 'Chosen\nlines' },
    parse,
  );
  assert.equal(clip.title, 'example.org');
  assert.equal(clip.markdown, '> Chosen\n> lines\n\nBody text');
});

test('titles drop the site name only when the rest is a real title', () => {
  assert.equal(articleTitle(parse('<title>Rivers in spring | Paper</title>')), 'Rivers in spring');
  assert.equal(articleTitle(parse('<title>Home | Paper</title>')), 'Home | Paper');
  assert.equal(
    articleTitle(parse('<head><meta property="og:title" content="From OG"><title>x</title></head>')),
    'From OG',
  );
});

test('a region becomes a picture with the source page', () => {
  const clip = regionClip({ url: URL_, title: 'Chart' }, 'iVBORw0KGgo=');
  assert.deepEqual(clip.attachments, [{ name: 'Clip.png', mime: 'image/png', data: 'iVBORw0KGgo=' }]);
  assert.equal(clip.sourceUrl, URL_);
  assert.deepEqual(cropBox({ x: 10, y: 20, width: 100, height: 50 }, 2, 4000, 3000), {
    x: 20,
    y: 40,
    width: 200,
    height: 100,
  });
  assert.deepEqual(cropBox({ x: 110, y: 70, width: -100, height: -50 }, 1, 4000, 3000), {
    x: 10,
    y: 20,
    width: 100,
    height: 50,
  });
  assert.deepEqual(cropBox({ x: 0, y: 0, width: 5000, height: 5000 }, 1, 800, 600), {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
  assert.equal(cropBox({ x: 0, y: 0, width: 3, height: 3 }, 1, 800, 600), null);
});

test('the opennote://clip fallback fits the app’s link rules', () => {
  const allowed = /^opennote:\/\/[A-Za-z0-9/_%#?=&.-]+$/;
  const link = clipLink('https://example.org/a b?c=d', 'Rivers (in) spring!');
  assert.match(link, allowed);
  assert.equal(new URL(link).searchParams.get('title'), 'Rivers (in) spring!');
  assert.equal(new URL(link).searchParams.get('url'), 'https://example.org/a b?c=d');
  const long = clipLink('https://example.org/', 'word '.repeat(300));
  assert.ok(long.length <= 512);
  assert.match(long, allowed);
  assert.equal(clipLink('file:///c:/x', 'x'), null);
  assert.equal(clipLink(`https://example.org/${'a'.repeat(600)}`, 'x'), null);
});

test('a Gmail message becomes a page with its sender, link, and files', () => {
  const message = {
    subject: 'Field trip',
    from: { name: 'Ms. Rivera', email: 'rivera@example.org' },
    to: [{ name: 'Class', email: 'class@example.org' }],
    date: '2026-03-02T09:30:00Z',
    html: '<div><p>Bring <b>boots</b>.</p></div>',
    downloads: [
      'application/pdf:Permission.pdf:https://mail.google.com/mail/u/0?ui=2&view=att&th=1',
      'text/html:evil.html:https://evil.example/x',
    ],
    link: 'https://mail.google.com/mail/u/0/#inbox/FMfcgz',
  };
  const downloads = gmailDownloads(message);
  assert.deepEqual(downloads, [
    { mime: 'application/pdf', name: 'Permission.pdf', url: 'https://mail.google.com/mail/u/0?ui=2&view=att&th=1' },
  ]);
  const { page, skipped } = gmailClip(message, parse, [
    { name: 'Permission.pdf', mime: 'application/pdf', size: 3, data: 'JVBE' },
  ]);
  assert.equal(page.title, 'Field trip');
  assert.equal(page.sourceUrl, message.link);
  assert.match(page.markdown, /\*\*From:\*\* Ms\. Rivera \(rivera@example\.org\)/);
  assert.match(page.markdown, /\*\*Sent:\*\* 2026-03-02 09:30 UTC/);
  assert.match(page.markdown, /\[Open the message\]\(https:\/\/mail\.google\.com/);
  assert.match(page.markdown, /Bring \*\*boots\*\*\./);
  assert.deepEqual(page.attachments, [{ name: 'Permission.pdf', mime: 'application/pdf', data: 'JVBE' }]);
  assert.deepEqual(skipped, []);
});
