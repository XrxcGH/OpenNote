// The Insert menu of a kit tool: the answer line, the headline equation, the result table, the worked steps, the
// plot as a picture, and a cycle's state table. Each choice says in words whether the page took it.
import { t } from '../../../../strings/t';
import { Button, announce, openMenu, type MenuItemSpec } from '../../../../ui';
import type { PlotSpec, ThermoResult } from '../common/types';
import type { System } from '../common/units';
import { PICTURE_COLORS } from './exportColors';
import { insertIntoPage, svgToPng } from './insert';
import { plotSvg } from './plotSvg';
import { answerLine, plotWords, resultTable, stateTable, stepsText } from './present';
import { say } from './say';

export function InsertMenu({ result, system, title }: { result: ThermoResult | null; system: System; title: string }) {
  const done = (took: boolean) => announce(t(took ? 'kitThermo.ui.inserted' : 'kitThermo.ui.noPage'));
  const actions: Record<string, (r: ThermoResult) => void> = {
    answer: (r) => done(insertIntoPage({ text: `${title}: ${answerLine(r, system, say)}` })),
    equation: (r) => done(insertIntoPage({ math: { source: r.latex, display: true } })),
    table: (r) => done(insertIntoPage({ table: resultTable(r, system, say) })),
    steps: (r) => done(insertIntoPage({ text: `${title}\n${stepsText(r.steps, say)}` })),
    states: (r) => done(insertIntoPage({ table: stateTable(r.states ?? [], system) })),
  };
  const picture = async (plot: PlotSpec) => {
    const name = say(`kitThermo.plot.${plot.title}`);
    const bytes = await svgToPng(plotSvg(plotWords(plot, say), system, PICTURE_COLORS, name));
    if (!bytes) return announce(t('kitThermo.ui.pictureFailed'));
    done(insertIntoPage({ picture: { bytes, name: `${name}.png`, alt: name, mime: 'image/png' } }));
  };
  const open = async (anchor: HTMLElement) => {
    if (!result) return;
    const items: MenuItemSpec[] = [
      { id: 'answer', label: t('kitThermo.ui.insertAnswer') },
      { id: 'equation', label: t('kitThermo.ui.insertEquation') },
      { id: 'table', label: t('kitThermo.ui.insertTable') },
      { id: 'steps', label: t('kitThermo.ui.insertSteps'), disabled: !result.steps.length },
      ...(result.states?.length ? [{ id: 'states', label: t('kitThermo.ui.insertStates') }] : []),
      ...(result.plots ?? []).map((plot, i) => ({
        id: `picture-${i}`,
        label: t('kitThermo.ui.insertPicture', { title: say(`kitThermo.plot.${plot.title}`) }),
      })),
    ];
    const chosen = await openMenu({ label: t('kitThermo.ui.insertMenu'), anchor, returnFocus: anchor, items });
    const plot = chosen?.startsWith('picture-') ? result.plots?.[Number(chosen.slice(8))] : undefined;
    if (plot) await picture(plot);
    else if (chosen && actions[chosen]) actions[chosen](result);
  };
  return (
    <Button
      variant="primary"
      disabled={!result}
      aria-haspopup="menu"
      onClick={(event) => void open(event.currentTarget as HTMLElement)}
    >
      {t('kitThermo.ui.insert')}
    </Button>
  );
}
