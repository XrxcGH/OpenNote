// A line of LaTeX drawn with KaTeX, which loads the first time one is shown so the window itself stays small. While it
// loads, or if the source cannot be drawn, the source is shown as text.
import { useEffect, useState } from 'react';
import 'katex/dist/katex.min.css';
import type { RenderOptions, RenderResult } from '../../../math';

type Renderer = (latex: string, options: RenderOptions) => RenderResult;

let loaded: Renderer | null = null;

export function MathLine({ latex, display = false }: { latex: string; display?: boolean }) {
  const [render, setRender] = useState<Renderer | null>(loaded);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void import('../../../math').then((math) => {
      loaded = math.renderLatex;
      if (live) setRender(() => math.renderLatex);
    });
    return () => {
      live = false;
    };
  }, []);
  const drawn = render ? render(latex, { displayMode: display }) : null;
  if (drawn?.ok) return <span dangerouslySetInnerHTML={{ __html: drawn.html }} />;
  return <code>{latex}</code>;
}
