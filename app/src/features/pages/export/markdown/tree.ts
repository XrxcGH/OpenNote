// The neutral document tree that OpenNote Markdown stands for (format spec 7.8, and the README beside the shared
// fixtures). The parser here produces it, and the export renderers read it.

/** A mark on a run of text. The object forms carry a value. */
export type Mark =
  | 'strong'
  | 'emphasis'
  | 'strike'
  | 'underline'
  | 'highlight'
  | 'sub'
  | 'sup'
  | 'code'
  | { readonly link: string }
  | { readonly highlight: string }
  | { readonly color: string }
  | { readonly size: string };

export type Inline =
  | { readonly text: string; readonly marks: readonly Mark[] }
  | { readonly hardBreak: true }
  | { readonly image: string; readonly alt: string };

export interface ListItem {
  readonly task: 'open' | 'done' | null;
  readonly blocks: readonly Block[];
}

export type Block =
  | { readonly type: 'paragraph'; readonly content: readonly Inline[] }
  | { readonly type: 'heading'; readonly level: number; readonly content: readonly Inline[] }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly start?: number;
      readonly items: readonly ListItem[];
    }
  | { readonly type: 'quote'; readonly blocks: readonly Block[] }
  | {
      readonly type: 'callout';
      readonly callout: string;
      readonly fold: 'folded' | 'open' | null;
      readonly title: readonly Inline[];
      readonly blocks: readonly Block[];
    }
  | { readonly type: 'code'; readonly language: string; readonly text: string }
  | { readonly type: 'break' };

export type Document = readonly Block[];

/** The plain text of inline content: no marks, and a hard break as a line break. Images give their description. */
export function inlineText(content: readonly Inline[]): string {
  return content
    .map((run) => ('text' in run ? run.text : 'hardBreak' in run ? '\n' : run.alt))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The plain text of a document, one block per line. Used for titles, summaries, and a text layer check. */
export function documentText(blocks: Document): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'heading') lines.push(inlineText(block.content));
    else if (block.type === 'code') lines.push(block.text);
    else if (block.type === 'list') for (const item of block.items) lines.push(documentText(item.blocks));
    else if (block.type === 'quote') lines.push(documentText(block.blocks));
    else if (block.type === 'callout') lines.push(inlineText(block.title), documentText(block.blocks));
  }
  return lines.filter((line) => line !== '').join('\n');
}
