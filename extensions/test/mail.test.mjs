import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LIMITS } from '../clipper/shared/api.js';
import { cleanMime, messageToPage, parseGmailDownload } from '../clipper/shared/mail.js';
import { itemToMessage, outlookLink } from '../outlook-addin/lib/outlook.js';

test('an Outlook item maps to a page with its files, a link back, and nothing inline', () => {
  const item = {
    subject: 'Quarterly notes',
    from: { displayName: 'Sam Lee', emailAddress: 'sam@example.org' },
    to: [{ displayName: 'Team', emailAddress: 'team@example.org' }],
    dateTimeCreated: new Date('2026-05-01T14:05:00Z'),
    markdown: 'Numbers attached.',
    link: outlookLink('https://outlook.office.com/api', 'AAMk/ab+c='),
    attachments: [
      {
        name: 'Report.xlsx',
        contentType: 'application/vnd.ms-excel',
        size: 4,
        isInline: false,
        attachmentType: 'file',
        content: { format: 'base64', content: 'AAAA' },
      },
      { name: 'logo.png', contentType: 'image/png', size: 4, isInline: true, attachmentType: 'file', content: null },
      {
        name: 'Plan',
        contentType: '',
        size: 0,
        isInline: false,
        attachmentType: 'cloud',
        content: { format: 'url', content: 'https://x' },
      },
    ],
  };
  const { page, skipped } = messageToPage(itemToMessage(item));
  assert.equal(page.title, 'Quarterly notes');
  assert.equal(page.sourceUrl, 'https://outlook.office.com/mail/deeplink/read/AAMk%2Fab%2Bc%3D');
  assert.match(page.markdown, /\*\*From:\*\* Sam Lee \(sam@example\.org\)/);
  assert.match(page.markdown, /\*\*To:\*\* Team \(team@example\.org\)/);
  assert.match(page.markdown, /\*\*Sent:\*\* 2026-05-01 14:05 UTC/);
  assert.match(page.markdown, /_Not attached: Plan\._/);
  assert.match(page.markdown, /---\n\nNumbers attached\.$/);
  assert.deepEqual(page.attachments, [{ name: 'Report.xlsx', mime: 'application/vnd.ms-excel', data: 'AAAA' }]);
  assert.deepEqual(skipped, [{ name: 'Plan', reason: 'notFile' }]);
});

test('Outlook.com messages link to Outlook.com, and no ID means no link', () => {
  assert.equal(outlookLink('https://outlook.live.com/api', 'id'), 'https://outlook.live.com/mail/deeplink/read/id');
  assert.equal(outlookLink('not a url', 'id'), 'https://outlook.live.com/mail/deeplink/read/id');
  assert.equal(outlookLink('https://outlook.office365.com/api', null), null);
});

test('a message keeps limits: subject length, attachment count and size, and safe text', () => {
  const big = { name: 'big.bin', mime: 'application/octet-stream', size: LIMITS.attachment + 1, data: 'AAAA' };
  const small = (at) => ({ name: `f${at}.txt`, mime: 'text/plain; charset=utf-8', size: 3, data: 'QUJD' });
  const { page, skipped } = messageToPage({
    subject: `${'S'.repeat(250)}\nsecond line`,
    from: { name: 'A *star* [link](x)', email: '' },
    markdown: '',
    link: 'javascript:alert(1)',
    attachments: [big, ...Array.from({ length: 11 }, (_, at) => small(at))],
  });
  assert.equal(page.title.length, 200);
  assert.equal(page.sourceUrl, undefined);
  assert.doesNotMatch(page.markdown, /javascript/);
  assert.match(page.markdown, /A \\\*star\\\* \\\[link\\\]\(x\)/);
  assert.equal(page.attachments.length, 10);
  assert.equal(page.attachments[0].mime, 'text/plain');
  assert.deepEqual(
    skipped.map((each) => each.reason),
    ['tooLarge', 'tooMany'],
  );
  assert.equal(messageToPage({ subject: '  ' }).page.title, 'Email without a subject');
});

test('Gmail download entries keep only Gmail addresses and clean types', () => {
  assert.deepEqual(parseGmailDownload('image/png:a.png:https://mail.google.com/mail/?view=att&disp=safe'), {
    mime: 'image/png',
    name: 'a.png',
    url: 'https://mail.google.com/mail/?view=att&disp=safe',
  });
  for (const bad of [
    '',
    'x',
    'image/png:a.png:http://mail.google.com/x',
    'image/png:a.png:https://mail.google.com.evil.example/x',
    'image/png::https://mail.google.com/x',
  ]) {
    assert.equal(parseGmailDownload(bad), null, bad);
  }
  assert.equal(cleanMime('Text/HTML; charset=x'), 'text/html');
  assert.equal(cleanMime('<script>'), 'application/octet-stream');
});
