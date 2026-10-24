// Embedded text in exports. On the page an embed is a live card under a line like `![[Page]]`. A Markdown file, a web
// page, or a PDF has no cards, so the line becomes the embedded text itself, in a quote headed by the page's title.
// An embed inside an embedded page stays as the line it is, so two pages that embed each other can't loop.
import { parseEmbed } from './model';
import type { EmbedRef } from './model';

export interface EmbedText {
  /** The title of the page the text came from. */
  title: string;
  markdown: string;
}

/** Reads the text an embed shows now. Resolves null when the page or the part of it is not there. */
export type EmbedLoader = (ref: EmbedRef) => Promise<EmbedText | null>;

/** The lines of a text box that are only an embed, outside code fences. */
export function embedLines(markdown: string): { index: number; ref: EmbedRef }[] {
  const found: { index: number; ref: EmbedRef }[] = [];
  let fence: string | null = null;
  markdown.split('\n').forEach((line, index) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark) {
      if (fence === null) fence = mark[0];
      else if (mark[0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const ref = parseEmbed(line);
    if (ref) found.push({ index, ref });
  });
  return found;
}

/** The embedded text as a quote: the page's title in bold, then its text. */
export function embedQuote(embed: EmbedText): string {
  const body = embed.markdown.trim().split('\n');
  return ['**' + embed.title.replace(/\*/g, '') + '**', '', ...body]
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/** The text with each embed line replaced by what it embeds. A line whose page can't be read stays as it was. */
export async function expandEmbedText(markdown: string, load: EmbedLoader): Promise<string> {
  const found = embedLines(markdown);
  if (found.length === 0) return markdown;
  const lines = markdown.split('\n');
  for (const { index, ref } of found) {
    const text = await load(ref).catch(() => null);
    if (text && text.markdown.trim() !== '') lines[index] = embedQuote(text);
  }
  return lines.join('\n');
}
