// Typed #hashtags (Settings, Editing, "Turn typed #words into tags"). A word that starts with `#` and is finished by a
// space or punctuation becomes one of the page's tags, so Manage tags lists it and `tag:` finds the page. The text
// keeps the word; the editor writes its `#` escaped, so the Markdown stays what the format says (section 7.6), and
// the tag lives in the page's own tags. The tag is its own undo step: Ctrl+Z right after leaves the plain `#word`.
import { fold } from '../../../services/search/text';
import type { Edit, OpenPage } from '../../../services/pages/types';

// A word start, an optional escape, `#`, and a tag that something ends: a space or punctuation. Numbers alone (`#123`)
// are not tags, and a `#` after a letter (`C#`) is not at a word start. The editor writes a space that ends the text,
// or a second one in a row, as `&#32;`, so that counts as a space.
const SPACE = String.raw`(?:\s|&#32;|&#160;|&nbsp;)`;
const TYPED = new RegExp(
  String.raw`(?:^|${SPACE})\\?#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)(?=[^\p{L}\p{N}_/-])`,
  'gu',
);
const MOST = 200;
const BLANK = '\u0001';

/** The text with code (spans and fences), link destinations, and web addresses blanked, so no tag is read inside. */
function outsideCode(markdown: string): string {
  return markdown
    .replace(/(`+)[\s\S]*?\1/g, BLANK)
    .replace(/\]\([^)]*\)/g, `]${BLANK}`)
    .replace(/<[a-z][a-z0-9+.-]*:[^>\s]*>|\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, BLANK);
}

/** The normal form of a tag: no empty parts, folded. Matches crates/search. */
function normal(tag: string): string {
  return fold(tag)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

/** The tags finished in `markdown`, in normal form, outside code and web addresses. */
export function typedTags(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of outsideCode(markdown).matchAll(TYPED)) {
    const tag = normal(match[1].replace(/[-/]+$/, ''));
    if (tag && tag.length <= MOST) found.add(tag);
  }
  return [...found];
}

const known = new WeakMap<OpenPage, string[]>();

function tagsOf(page: OpenPage): string[] {
  let tags = known.get(page);
  if (!tags) {
    tags = [...page.initial.tags];
    known.set(page, tags);
    page.onFrame((frame) => {
      if (frame.page?.tags) known.set(page, [...frame.page.tags]);
    });
  }
  return tags;
}

/** The edit that adds the tags newly finished by a change from `before` to `after`, or null when there are none. */
export function tagEdit(page: OpenPage, before: string, after: string): Edit | null {
  if (page.readOnly) return null;
  const old = new Set(typedTags(before));
  const tags = tagsOf(page);
  const have = new Set(tags.map(normal));
  const added = typedTags(after).filter((tag) => !old.has(tag) && !have.has(tag));
  if (added.length === 0) return null;
  const next = [...tags, ...added];
  known.set(page, next);
  return { edit: 'setPage', tags: next };
}
