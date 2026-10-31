// The Insert buttons of a tool: the answer as text, with its steps, as a table, the main equation, and the plot as a
// picture. Each writes at the caret of the page that is open and says in words what happened.
import { Button, announce } from '../../../../ui';
import { insertIntoPage } from '../../ui/insert';
import tools from '../../ui/tools.module.css';
import { plotSvg } from '../plot';
import type { Solved } from '../types';
import type { System } from '../units';
import { showRow, tr } from './text';

const lines = (solved: Solved, system: System) =>
  solved.rows.map((row) => {
    const shown = showRow(row, system);
    return `${shown.label}: ${shown.value}${shown.unit ? ` ${shown.unit}` : ''}`;
  });

export function plotText(solved: Solved) {
  const plot = solved.plot!;
  return { x: tr(plot.xLabel), y: tr(plot.yLabel), series: plot.series.map((s) => tr(s.label, s.labelVars)) };
}

const done = (ok: boolean) => announce(tr(ok ? 'kitChemMat.common.inserted' : 'kitChemMat.common.noPage'));

/** The answer, then each step as a line of words followed by its equation as a math block, never as LaTeX source. */
function insertSteps(solved: Solved, system: System) {
  let ok = insertIntoPage({ text: lines(solved, system).join('\n') });
  solved.steps.forEach((step, i) => {
    if (!ok) return;
    ok = insertIntoPage({ text: `${i + 1}. ${tr(step.key, step.vars)}` });
    if (ok && step.math) ok = insertIntoPage({ math: { source: step.math, display: true } });
  });
  done(ok);
}

function insertTable(solved: Solved, system: System) {
  const header = [tr('kitChemMat.common.quantity'), tr('kitChemMat.common.value'), tr('kitChemMat.common.unit')];
  const rows = solved.rows.map((row) => {
    const s = showRow(row, system);
    return [s.label, s.value, s.unit];
  });
  done(insertIntoPage({ table: { header, rows } }));
}

function insertPlot(solved: Solved, id: string) {
  if (!solved.plot) return;
  const bytes = new TextEncoder().encode(plotSvg(solved.plot, plotText(solved), false));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  done(
    insertIntoPage({ picture: { bytes: buffer, name: `${id}.svg`, alt: tr(solved.plot.alt), mime: 'image/svg+xml' } }),
  );
}

export function InsertBar({ solved, system, toolId }: { solved: Solved; system: System; toolId: string }) {
  return (
    <div className={tools.buttons}>
      <Button variant="primary" onClick={() => done(insertIntoPage({ text: lines(solved, system).join('\n') }))}>
        {tr('kitChemMat.common.insertAnswer')}
      </Button>
      <Button variant="quiet" onClick={() => insertSteps(solved, system)}>
        {tr('kitChemMat.common.insertSteps')}
      </Button>
      <Button variant="quiet" onClick={() => insertTable(solved, system)}>
        {tr('kitChemMat.common.insertTable')}
      </Button>
      {solved.equation ? (
        <Button
          variant="quiet"
          onClick={() => done(insertIntoPage({ math: { source: solved.equation!, display: true } }))}
        >
          {tr('kitChemMat.common.insertEquation')}
        </Button>
      ) : null}
      {solved.plot ? (
        <Button variant="quiet" onClick={() => insertPlot(solved, toolId)}>
          {tr('kitChemMat.common.insertPlot')}
        </Button>
      ) : null}
    </div>
  );
}
