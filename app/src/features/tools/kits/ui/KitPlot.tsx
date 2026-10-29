// A kit plot in the window: the SVG from plot.ts in the theme's colors, with zoom in, zoom out, and zoom to fit. The
// picture is an image with a text summary; the numbers it shows are always in the results table or steps as well.
import { useMemo, useState } from 'react';
import { Button } from '../../../../ui';
import type { PlotSpec, PlotView } from './plot';
import { fitView, plotSvg, zoomView } from './plot';
import { say } from './words';
import styles from './kit.module.css';

const WIDTH = 520;
const HEIGHT = 320;

/** The plot's text summary, for its alternative text and the picture inserted into the page. */
export const plotSummary = (spec: PlotSpec): string =>
  say('kits.plot.summary', { title: spec.title, x: spec.x.label, y: spec.y.label });

export function KitPlot({ spec }: { spec: PlotSpec }) {
  const fitted = useMemo(() => fitView(spec, WIDTH, HEIGHT), [spec]);
  const [view, setView] = useState<PlotView | null>(null);
  const shown = view ?? fitted;
  const svg = useMemo(
    () => plotSvg(spec, { width: WIDTH, height: HEIGHT, palette: 'screen', view: shown }),
    [spec, shown],
  );
  const empty = spec.series.every((series) => series.points.length === 0);
  if (empty) return <p className={styles.note}>{say('kits.plot.empty')}</p>;
  return (
    <figure className={styles.plotFrame} style={{ margin: 0 }}>
      {/* The SVG is built by plot.ts, which escapes every piece of text it draws. */}
      <div
        className={styles.plot}
        role="img"
        aria-label={plotSummary(spec)}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className={styles.plotButtons}>
        <Button variant="quiet" onClick={() => setView(zoomView(shown, 0.5))}>
          {say('kits.plot.zoomIn')}
        </Button>
        <Button variant="quiet" onClick={() => setView(zoomView(shown, 2))}>
          {say('kits.plot.zoomOut')}
        </Button>
        <Button variant="quiet" disabled={view === null} onClick={() => setView(null)}>
          {say('kits.plot.zoomFit')}
        </Button>
      </div>
    </figure>
  );
}
