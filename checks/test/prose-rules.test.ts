// Tests for the rules that read natural language: spelling, grammar, AI markers, redundancy,
// length, readability and document usability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messages, run } from './helpers.ts';
import { spelling } from '../rules/spelling.ts';
import { expectedArticle, grammar } from '../rules/grammar.ts';
import { aiMarkers } from '../rules/ai-markers.ts';
import { redundancy } from '../rules/redundancy.ts';
import { length } from '../rules/length.ts';
import { readability } from '../rules/readability.ts';
import { githubSlug, usability } from '../rules/usability.ts';
import { applyFixes } from '../fix.ts';
import { cleanInline } from '../text.ts';

test('spelling flags British forms and suggests American ones', async () => {
  const found = await run({ rule: spelling, path: 'a.md', text: '# T\n\nThe colour of the centre was organised.\n' });
  assert.deepEqual(
    found.map((f) => f.fix?.to),
    ['color', 'center', 'organized'],
  );
});

test('spelling skips quotes, code spans and allowed words', async () => {
  const text = '# T\n\nHe said "colour" and ran `colour()` twice.\n';
  assert.equal((await run({ rule: spelling, path: 'a.md', text })).length, 0);
  const allowed = await run({
    rule: spelling,
    path: 'a.md',
    text: '# T\n\nGrey Street.\n',
    settings: { allow: ['grey'] },
  });
  assert.equal(allowed.length, 0);
});

test('spelling only reads comments in code', async () => {
  const text = 'const colour = 1; // the colour value\n';
  const found = await run({ rule: spelling, path: 'a.ts', text });
  assert.equal(found.length, 1);
});

test('spelling fixes are applied as whole words', () => {
  const result = applyFixes('The colour and colours.\n', [{ line: 1, from: 'colour', to: 'color' }]);
  assert.equal(result.text, 'The color and colours.\n');
});

test('URLs are removed from prose, including ones with parentheses', () => {
  assert.equal(cleanInline('See https://en.wikipedia.org/wiki/A_(b) now (or https://x.org).'), 'See now (or ).');
});

test('articles follow sound, including acronyms', () => {
  assert.equal(expectedArticle('hour'), 'an');
  assert.equal(expectedArticle('user'), 'a');
  assert.equal(expectedArticle('HTML'), 'an');
  assert.equal(expectedArticle('URL'), 'a');
  assert.equal(expectedArticle('OneNote'), 'a');
  assert.equal(expectedArticle('x-axis'), 'an');
});

test('grammar catches articles, repeats and confusions', async () => {
  const text = '# T\n\nThis is a apple. We could of left left early. It is faster then that.\n';
  const found = messages(await run({ rule: grammar, path: 'a.md', text }));
  assert.equal(found.length, 4);
});

test('grammar leaves correct text alone', async () => {
  const text = '# T\n\nAn hour passed. A user saw an HTML page and a URL. Plan A works.\n';
  assert.deepEqual(messages(await run({ rule: grammar, path: 'a.md', text })), []);
});

test('ai-markers separates strong markers from filler', async () => {
  const text = '# T\n\nLet us delve into this.\n\nIt works seamlessly.\n';
  const found = await run({ rule: aiMarkers, path: 'a.md', text });
  assert.deepEqual(
    found.map((f) => f.severity),
    ['error', 'warning'],
  );
});

test('ai-markers flags heavy em dash use', async () => {
  const sentence = 'The app saves notes — quickly — and syncs them later for you. ';
  const text = `# T\n\n${sentence.repeat(15)}\n`;
  const found = await run({ rule: aiMarkers, path: 'a.md', text });
  assert.ok(found.some((f) => f.message.includes('em dashes')));
});

test('redundancy flags wordy phrases and repeated paragraphs', async () => {
  const paragraph =
    'This paragraph is long enough to count as a real paragraph with twenty or more words in it for sure.';
  const text = `# T\n\nWe did this in order to test it.\n\n${paragraph}\n\n${paragraph}\n`;
  const found = await run({ rule: redundancy, path: 'a.md', text });
  assert.equal(found.filter((f) => f.severity === 'error').length, 2);
  assert.equal(found[0].fix?.to, 'to');
});

test('redundancy notices text copied from another document', async () => {
  const paragraph =
    'Shared text that appears in two documents word for word and is long enough to be flagged ' +
    'by the rule, which wants at least twenty-five words.';
  const files = { 'other.md': `# Other\n\n${paragraph}\n` };
  const found = await run({ rule: redundancy, path: 'copy.md', text: `# Copy\n\n${paragraph}\n`, files });
  assert.ok(found.some((f) => f.message.includes('other.md')));
});

test('length flags long sentences and sections', async () => {
  const longSentence = `${'word '.repeat(50)}end.`;
  const found = await run({ rule: length, path: 'a.md', text: `# T\n\n${longSentence}\n` });
  assert.ok(found.some((f) => f.message.startsWith('Sentence has 51 words')));
  const section = await run({ rule: length, path: 'b.md', text: `# T\n\n${'Short one here. '.repeat(250)}\n` });
  assert.ok(section.some((f) => f.message.startsWith('Section has')));
});

test('readability asks for acronyms to be defined once', async () => {
  const text = '# T\n\nThe NPU is fast. The NPU is small.\n\nOptical character recognition (OCR) works. OCR helps.\n';
  const found = await run({ rule: readability, path: 'a.md', text });
  assert.deepEqual(messages(found), ['3:warning:Define "NPU" on first use, e.g. "full name (NPU)".']);
});

test('readability ignores file names and long all-caps words', async () => {
  const text = '# T\n\nSee DEVELOPMENT.md and the README file. IMPORTANTLY, nothing else.\n';
  assert.deepEqual(messages(await run({ rule: readability, path: 'a.md', text })), []);
});

test('readability flags dense sections', async () => {
  const dense = 'Interoperability considerations necessitate comprehensive architectural documentation. ';
  const found = await run({ rule: readability, path: 'a.md', text: `# T\n\n${dense.repeat(20)}\n` });
  assert.equal(found[0]?.severity, 'error');
});

test('usability checks headings, links and images', async () => {
  const text = '# Title\n\n### Skipped level\n\n[x](missing.md) [y](#nowhere) [z](#title) ![](pic.png)\n';
  const found = messages(await run({ rule: usability, path: 'a.md', text, files: { 'pic.png': '' } }));
  assert.equal(found.length, 4);
});

test('usability requires a table of contents in long documents', async () => {
  const text = `# Title\n\n${'Plain words here. '.repeat(600)}\n`;
  const found = await run({ rule: usability, path: 'a.md', text, settings: { tocMinWords: 1000 } });
  assert.ok(found.some((f) => f.message.includes('table of contents')));
});

test('heading slugs match GitHub', () => {
  assert.equal(
    githubSlug("5. Rising apps & what they offer that incumbents don't"),
    '5-rising-apps--what-they-offer-that-incumbents-dont',
  );
});

test('suppressions need a known rule and a reason', async () => {
  const text =
    '# T\n\n<!-- checks-disable-next-line spelling: quoting a product name -->\nColour Pro.\n\n' +
    '<!-- checks-disable-next-line spelling -->\nColour.\n';
  const found = await run({ rule: spelling, path: 'a.md', text });
  assert.deepEqual(
    found.map((f) => f.rule),
    ['suppression', 'spelling'],
  );
});
