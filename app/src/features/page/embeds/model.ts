// Page embeds: a paragraph that holds only `![[Page]]` or `![[Page#Heading]]` shows that
// page, or the text box with that heading, live under it. The Markdown keeps the plain text, like [[page links]], so
// the format does not change and a reader that does not know embeds shows the line as text.
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseTextBlock } from '../../../editor/markdown';
import { headingsOfDoc } from '../toc/headings';

export interface EmbedRef {
  title: string;
  heading: string | null;
  /** For `![[Page#^id]]`: the ID of the paragraph, which the embed shows the text box of. */
  element?: string;
}

const EMBED = /^!\[\[([^\]#|]+?)(?:#([^\]|]+?))?(?:\|[^\]]*)?\]\]$/;

/** The page and heading an embed line names, or null for any other text. */
export function parseEmbed(text: string): EmbedRef | null {
  const found = EMBED.exec(text.trim());
  if (!found) return null;
  const title = found[1].trim();
  const heading = found[2]?.trim() ?? null;
  if (title === '') return null;
  const element = heading !== null && heading.startsWith('^') ? heading.slice(1) : null;
  if (element !== null && /^[A-Za-z0-9_-]{6,64}$/.test(element)) return { title, heading: null, element };
  return { title, heading: heading === '' ? null : heading };
}

export interface FoundEmbed extends EmbedRef {
  /** Where the embed paragraph ends: the card goes there. */
  end: number;
}

/** The embeds in a document: top-level paragraphs that are only an embed line. */
export function findEmbeds(doc: PMNode): FoundEmbed[] {
  const found: FoundEmbed[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph') return;
    const ref = parseEmbed(node.textContent);
    if (ref) found.push({ ...ref, end: offset + node.nodeSize });
  });
  return found;
}

export interface EmbedSource {
  id: string;
  type: string;
  markdown: string;
  /** The IDs of the block's paragraphs, headings, and list items. */
  ids?: readonly string[];
}

const normal = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The text boxes an embed shows: all of a page's, or the first one that holds the heading. */
export function pickBlocks(blocks: readonly EmbedSource[], heading: string | null, element?: string): string[] {
  const texts = blocks.filter((block) => block.type === 'text');
  if (element !== undefined) return texts.filter((block) => block.ids?.includes(element)).map((block) => block.id).slice(0, 1);
  if (heading === null) return texts.map((block) => block.id);
  const wanted = normal(heading);
  const holder = texts.find((block) =>
    headingsOfDoc(parseTextBlock(block.markdown)).some((found) => normal(found.text) === wanted),
  );
  return holder ? [holder.id] : [];
}
