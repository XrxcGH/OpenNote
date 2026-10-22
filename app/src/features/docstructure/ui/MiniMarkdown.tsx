// A small reader for the Markdown the document-structure tools show: paragraphs, headings, list lines, emphasis, and
// math drawn by the math renderer. It is not the page's editor; it only shows text.
import { Fragment, useEffect, useState } from 'react';
import type { MathRenderer } from '../../../editor/host';
import { stripLabels } from '../../../editor/equations';

let loaded: Promise<MathRenderer> | null = null;

/** The math renderer, loaded the first time something with math is shown. */
export function useMathRenderer(): MathRenderer | null {
  const [renderer, setRenderer] = useState<MathRenderer | null>(null);
  useEffect(() => {
    let live = true;
    loaded ??= import('../../math').then((m) => m.mathRenderer);
    void loaded.then((r) => live && setRenderer(r)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return renderer;
}

function Math({ source, display, renderer }: { source: string; display: boolean; renderer: MathRenderer | null }) {
  const drawn = renderer?.render(stripLabels(source), display);
  if (drawn?.ok) {
    return <span role="math" aria-label={source} dangerouslySetInnerHTML={{ __html: drawn.html }} />;
  }
  return <code>{source}</code>;
}

const INLINE = /\$([^$\n]+)\$|\*\*([^*\n]+)\*\*|(?<![*\w])\*([^*\n]+)\*(?!\*)/g;

function Inline({ text, renderer }: { text: string; renderer: MathRenderer | null }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) parts.push(text.slice(last, at));
    if (m[1] !== undefined) parts.push(<Math key={at} source={m[1]} display={false} renderer={renderer} />);
    else if (m[2] !== undefined) parts.push(<strong key={at}>{m[2]}</strong>);
    else parts.push(<em key={at}>{m[3]}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Splits Markdown into display math and everything else, by lines. */
function blocks(markdown: string): ({ math: string } | { text: string })[] {
  const out: ({ math: string } | { text: string })[] = [];
  const buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) out.push({ text: buffer.join('\n') });
    buffer.length = 0;
  };
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '$$') {
      flush();
      const body: string[] = [];
      for (i += 1; i < lines.length && lines[i].trim() !== '$$'; i += 1) body.push(lines[i]);
      out.push({ math: body.join('\n') });
    } else buffer.push(lines[i]);
  }
  flush();
  return out;
}

export function MiniMarkdown({ markdown, renderer }: { markdown: string; renderer: MathRenderer | null }) {
  return (
    <>
      {blocks(markdown).map((block, i) =>
        'math' in block ? (
          <div key={i}>
            <Math source={block.math} display renderer={renderer} />
          </div>
        ) : (
          <Fragment key={i}>
            {block.text
              .split(/\n{2,}/)
              .filter((p) => p.trim() !== '')
              .map((paragraph, j) => {
                const heading = /^(#{1,6})\s+(.*)$/.exec(paragraph.trim());
                if (heading) {
                  return (
                    <p key={j}>
                      <strong>
                        <Inline text={heading[2]} renderer={renderer} />
                      </strong>
                    </p>
                  );
                }
                return (
                  <p key={j}>
                    {paragraph.split('\n').map((line, k) => (
                      <Fragment key={k}>
                        {k > 0 ? <br /> : null}
                        <Inline text={line.replace(/^(\s*)[-*+]\s+/, '$1• ')} renderer={renderer} />
                      </Fragment>
                    ))}
                  </p>
                );
              })}
          </Fragment>
        ),
      )}
    </>
  );
}
