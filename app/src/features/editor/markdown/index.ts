// The OpenNote Markdown dialect in the interface (SPEC 7). It parses a text block's `markdown` string into a
// ProseMirror document, writes a document back in canonical form, and moves element data (SPEC 6.6) in and out.
export { parseTextBlock, createMarkdown, buildDoc } from './parse';
export { serializeTextBlock } from './serialize';
export { serializeInline } from './inline';
export { PARAGRAPH, TITLE, escapeParagraphText } from './escape';
export { joinAdjacentLists, joinListsDeep } from './normalize';
