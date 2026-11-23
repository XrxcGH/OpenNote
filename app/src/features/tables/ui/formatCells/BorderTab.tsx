import { t } from '../../../../strings/t';
import type { Scheme } from '../../../../ui/color/parse';
import type { CellBox } from '../../sheet/formatTarget';
import { BORDER_STYLES } from '../../sheet/model/enums';
import { ColorField, Select } from './controls';
import { EDGES, edgeExists, presetEdges, sideOf } from './edges';
import type { Edge, Edges, Line } from './edges';
import styles from './formatCells.module.css';

export interface BorderTabProps {
  box: CellBox;
  edges: Edges;
  setEdges(edges: Edges): void;
  line: Line;
  setLine(line: Line): void;
  scheme: Scheme;
  notebookId: string;
}

export function BorderTab({ box, edges, setEdges, line, setLine, scheme, notebookId }: BorderTabProps) {
  const toggle = (edge: Edge) => {
    const next = { ...edges };
    if (next[edge]) delete next[edge];
    else next[edge] = sideOf(line);
    setEdges(next);
  };
  const restyle = (next: Line) => {
    setLine(next);
    const updated: Edges = {};
    for (const edge of EDGES) if (edges[edge]) updated[edge] = sideOf(next);
    setEdges(updated);
  };
  const presets = ['none', 'outline', 'inside'] as const;
  const button = (edge: Edge, className: string) => (
    <button
      key={edge}
      type="button"
      className={`${styles.edge} ${className}`}
      aria-pressed={edges[edge] !== undefined}
      disabled={!edgeExists(edge, box)}
      onClick={() => toggle(edge)}
    >
      {t(`sheetFormat.border.edge.${edge}`)}
    </button>
  );
  return (
    <div className={styles.grid}>
      <fieldset className={styles.group}>
        <legend>{t('sheetFormat.border.presets')}</legend>
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={styles.preset}
            disabled={preset === 'inside' && !edgeExists('ih', box) && !edgeExists('iv', box)}
            onClick={() => setEdges(presetEdges(preset, line, box, edges))}
          >
            {t(`sheetFormat.border.${preset}`)}
          </button>
        ))}
      </fieldset>
      <Select
        label={t('sheetFormat.border.line')}
        value={line.style as (typeof BORDER_STYLES)[number]}
        values={BORDER_STYLES}
        name={(v) => t(`sheetFormat.lineStyle.${v}`)}
        onChange={(style) => restyle({ ...line, style })}
      />
      <ColorField
        label={t('sheetFormat.border.lineColor')}
        value={line.color}
        scheme={scheme}
        notebookId={notebookId}
        onPick={(color) => restyle({ style: line.style, ...(color === undefined ? {} : { color }) })}
      />
      <div className={styles.diagram} role="group" aria-label={t('sheetFormat.border.diagram')}>
        {button('t', styles.top)}
        {button('l', styles.left)}
        {button('r', styles.right)}
        {button('b', styles.bottom)}
        {button('ih', styles.insideH)}
        {button('iv', styles.insideV)}
        {button('dd', styles.diagDown)}
        {button('du', styles.diagUp)}
      </div>
      {!edgeExists('ih', box) || !edgeExists('iv', box) ? (
        <p className={styles.help}>{t('sheetFormat.border.insideNote')}</p>
      ) : null}
    </div>
  );
}
