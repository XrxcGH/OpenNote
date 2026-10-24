// Drawing a diagram from Mermaid text, on this device (Further features, Phase 7). Mermaid loads the first time a
// diagram is shown and nowhere else, so pages without diagrams never fetch it. It runs in its strictest mode, which
// removes scripts and links from what it draws, and nothing leaves the computer.

type Mermaid = (typeof import('mermaid'))['default'];

let loading: Promise<Mermaid> | null = null;
let counter = 0;

function wantsDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

async function engine(): Promise<Mermaid> {
  loading ??= import('mermaid').then((loaded) => loaded.default);
  const mermaid = await loading;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: wantsDark() ? 'dark' : 'neutral',
    // checks-disable-next-line brand-consistency: inherit is not a font; the diagram keeps the page's font token
    fontFamily: 'inherit',
    flowchart: { htmlLabels: false },
  });
  return mermaid;
}

export type Drawn = { ok: true; svg: string } | { ok: false; message: string };

/** The diagram as an SVG string, or what is wrong with the text in Mermaid's own words. */
export async function drawDiagram(source: string): Promise<Drawn> {
  if (source.trim() === '') return { ok: false, message: '' };
  const mermaid = await engine();
  try {
    await mermaid.parse(source);
    counter += 1;
    const id = `opennote-diagram-${counter}`;
    const { svg } = await mermaid.render(id, source);
    // Mermaid leaves its scratch element behind when a drawing fails; this clears it either way.
    document.getElementById(`d${id}`)?.remove();
    return { ok: true, svg };
  } catch (error) {
    document.getElementById(`dopennote-diagram-${counter}`)?.remove();
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message.split('\n').slice(0, 4).join('\n') };
  }
}
