// Tests for the HTML comment, tag, and entity handling behind the Markdown and SVG rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtmlEntities, stripHtmlComments, stripHtmlTags } from '../html.ts';
import { markdownProse } from '../markdown.ts';
import { githubSlug } from '../rules/usability.ts';
import { cleanInline } from '../text.ts';

const proseTexts = (lines: string[]): string[] => markdownProse(lines).map((p) => p.text);

test('an ampersand is decoded once: "&amp;lt;" is the text "&lt;", not "<"', () => {
  assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeHtmlEntities('&amp;amp;'), '&amp;');
  assert.equal(decodeHtmlEntities('&amp;quot;'), '&quot;');
  assert.equal(decodeHtmlEntities('&lt;b&gt; &amp; &quot;x&quot;'), '<b> & "x"');
  assert.equal(decodeHtmlEntities('a &unknown; b & c'), 'a &unknown; b & c');
});

test('comments end at "-->", at "--!>", and in the short forms "<!-->" and "<!--->"', () => {
  assert.deepEqual(stripHtmlComments('a <!-- x --> b'), { text: 'a  b', open: false });
  assert.deepEqual(stripHtmlComments('a <!-- x --!> b'), { text: 'a  b', open: false });
  assert.deepEqual(stripHtmlComments('a <!--> b'), { text: 'a  b', open: false });
  assert.deepEqual(stripHtmlComments('a <!---> b'), { text: 'a  b', open: false });
  assert.deepEqual(stripHtmlComments('a <!----> b'), { text: 'a  b', open: false });
});

test('a comment that does not end on the line stays open for the next line', () => {
  assert.deepEqual(stripHtmlComments('a <!-- x'), { text: 'a ', open: true });
  assert.deepEqual(stripHtmlComments('y --> b', true), { text: ' b', open: false });
  assert.deepEqual(stripHtmlComments('y', true), { text: '', open: true });
  // On a later line, ">" alone does not end a comment: only "-->" and "--!>" do.
  assert.deepEqual(stripHtmlComments('> still inside', true), { text: '', open: true });
});

test('removing a comment cannot leave a new comment behind', () => {
  assert.deepEqual(stripHtmlComments('<!<!-- x -->-- y -->'), { text: '', open: false });
  assert.deepEqual(stripHtmlComments('<!<!-- x -->-- y'), { text: '', open: true });
  assert.deepEqual(stripHtmlComments('<!<!-- x -->-- y --> z'), { text: ' z', open: false });
});

test('Markdown prose skips comments that end with "--!>", so the next lines are kept', () => {
  assert.deepEqual(proseTexts(['Before <!-- hidden --!> after', 'Next line.']), ['Before after', 'Next line.']);
});

test('Markdown prose skips the short comment "<!-->" without hiding the next lines', () => {
  assert.deepEqual(proseTexts(['A <!--> B', 'Next line.']), ['A B', 'Next line.']);
});

test('Markdown prose skips a comment that removal would rebuild, without hiding the next lines', () => {
  assert.deepEqual(proseTexts(['Kept <!<!-- x -->-- y -->', 'Next line.']), ['Kept', 'Next line.']);
});

test('Markdown prose still skips comments that span lines', () => {
  assert.deepEqual(proseTexts(['One.', '<!-- start', 'hidden', 'end --> Two.', 'Three.']), ['One.', 'Two.', 'Three.']);
});

test('tags are removed in any letter case, with quoted ">" inside attributes', () => {
  assert.equal(stripHtmlTags('a <B>bold</B> <SCRIPT src="x">y</SCRIPT> <a title="1 > 0">z</a>'), 'a bold y z');
  assert.equal(stripHtmlTags('a <br/> b <!DOCTYPE html> c'), 'a  b  c');
});

test('removing a tag cannot leave a new tag behind', () => {
  assert.equal(stripHtmlTags('<<b>b>text'), 'text');
  assert.equal(stripHtmlTags('<<script>script>alert(1)<</script>/script>'), 'alert(1)');
});

test('tag removal also removes comments, including ones with ">" or "--!>" inside', () => {
  assert.equal(stripHtmlTags('a <!-- c > d --> b'), 'a  b');
  assert.equal(stripHtmlTags('a <!-- c --!> b'), 'a  b');
  assert.equal(stripHtmlTags('a <!-- open'), 'a ');
});

test('"<" that does not start a tag is text', () => {
  assert.equal(stripHtmlTags('if a < b and c > d'), 'if a < b and c > d');
  assert.equal(stripHtmlTags('x <y'), 'x <y');
});

test('heading slugs drop tags that removal would rebuild', () => {
  assert.equal(githubSlug('<<b>b>Heading'), 'heading');
  assert.equal(githubSlug('<SCRIPT>Run</SCRIPT> it'), 'run-it');
  assert.equal(githubSlug('Compare <!-- a > b --> values'), 'compare--values');
});

test('cleanInline drops tags and comments, in any letter case', () => {
  assert.equal(cleanInline('a <B>bold</B> <!-- c > d --> e'), 'a bold e');
});
