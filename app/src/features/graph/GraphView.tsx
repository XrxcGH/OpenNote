// checks-disable-file modifiability: one dialog whose parts share its state; split it when it grows again
// The graph view and the Connections list. Pages are dots and links are lines, for a notebook, for every notebook, or
// for the pages within one to three links of the open page. The picture is for the eye; the Connections list says the
// same in words, for the keyboard and for screen readers, and pages no link reaches have a list of their own.
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from '../../app/location';
import { commandContext } from '../../commands/registry';
import type { Connections, LinkGraphData, Neighbor, PageFact } from '../../services/search/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Button, Dialog, TextField, announce } from '../../ui';
import { maybeSearchClient, openAndReveal } from '../search';
import styles from './graph.module.css';
import { MAX_NODES, labelAt, layoutGraph, limitNodes } from './layout';
import type { Point } from './layout';
import { NO_FILTER, drawn, unlinked } from './model';
import type { GraphFilter } from './model';

type Scope = 'notebook' | 'all' | 'around';
const WIDTH = 720;
const HEIGHT = 420;
const titleAt = (point: Point, title: string) => {
  const { x, y, anchor } = labelAt(point, WIDTH, title);
  return { x, y, textAnchor: anchor };
};
const EMPTY: LinkGraphData = { pages: [], edges: [], orphans: [], broken: 0 };

function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; text: string }[];
  onChange(value: string): void;
}) {
  return (
    <label className={styles.pick}>
      <span>{label}</span>
      <select className={styles.select} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function GraphView({ onClose }: OverlayProps) {
  const here = useLocation();
  const workspace = here.view === 'workspace' ? here : null;
  const current = workspace?.pageId ?? null;
  const [scope, setScope] = useState<Scope>(current ? 'around' : 'notebook');
  const [depth, setDepth] = useState(1);
  const [filter, setFilter] = useState<GraphFilter>(NO_FILTER);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(current);
  const [data, setData] = useState<LinkGraphData | null>(null);
  const [facts, setFacts] = useState<Map<string, PageFact>>(new Map());
  const [near, setNear] = useState<Set<string> | null>(null);
  const [links, setLinks] = useState<Connections | null>(null);
  const [sectionNames, setSectionNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let live = true;
    const { notes } = commandContext('palette');
    void (async () => {
      const found = new Map<string, string>();
      for (const notebook of await notes.listNotebooks()) {
        for (const node of await notes.listChildren(notebook.id)) {
          if (node.kind === 'section') found.set(node.id, `${notebook.title} / ${node.title}`);
        }
      }
      if (live) setSectionNames(found);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    const extras = maybeSearchClient()?.extras;
    if (!extras) return;
    void Promise.all([
      extras.linkGraph(scope === 'notebook' ? (workspace?.notebookId ?? null) : null),
      extras.pageFacts(null),
      scope === 'around' && current ? extras.neighbors(current, depth) : Promise.resolve<Neighbor[] | null>(null),
    ])
      .then(([graph, list, neighbors]) => {
        if (!live) return;
        setData(graph);
        setFacts(new Map(list.map((fact) => [fact.page, fact])));
        setNear(neighbors ? new Set([current as string, ...neighbors.map((n) => n.page)]) : null);
      })
      .catch(() => live && setData(EMPTY));
    return () => {
      live = false;
    };
  }, [scope, depth, current, workspace?.notebookId]);

  const hasExtras = maybeSearchClient()?.extras !== undefined;
  const graph = hasExtras ? data : EMPTY;
  const shown = useMemo(() => drawn(graph ?? EMPTY, facts, filter, near), [graph, facts, filter, near]);
  const kept = useMemo(() => limitNodes(shown.pages.length, shown.edges), [shown]);
  const view = useMemo(() => {
    const at = new Map(kept.map((old, index) => [old, index]));
    const pages = kept.map((old) => shown.pages[old]);
    const edges = shown.edges
      .filter(([a, b]) => at.has(a) && at.has(b))
      .map(([a, b]) => [at.get(a) as number, at.get(b) as number] as [number, number]);
    return { pages, edges };
  }, [kept, shown]);
  const points = useMemo(() => layoutGraph(view.pages.length, view.edges, WIDTH, HEIGHT), [view]);
  const lonely = useMemo(() => unlinked(shown), [shown]);

  useEffect(() => {
    const extras = maybeSearchClient()?.extras;
    if (!extras || !selected) return;
    let live = true;
    extras
      .connections(selected)
      .then((answer) => live && setLinks(answer))
      .catch(() => live && setLinks(null));
    return () => {
      live = false;
    };
  }, [selected]);

  const titleOf = (page: string) => graph?.pages.find((candidate) => candidate.page === page)?.title ?? page;
  const select = (page: string) => {
    setSelected(page);
    announce(t('qolSearch.graph.selected', { title: titleOf(page) }));
  };
  const open = (page: string) => {
    onClose();
    void openAndReveal(commandContext('palette').notes, page, null);
  };
  const selectedAt = view.pages.findIndex((page) => page.page === selected);
  const touching = new Set(view.edges.filter(([a, b]) => a === selectedAt || b === selectedAt).flat());
  const sections = [...new Set([...facts.values()].map((fact) => fact.section))];
  const tags = [...new Set([...facts.values()].flatMap((fact) => fact.tags))].sort();
  const names = [
    ...new Set(
      [...facts.values()].flatMap((fact) =>
        ((fact.properties as { fields?: { name: string }[] } | undefined)?.fields ?? []).map((f) => f.name),
      ),
    ),
  ].sort();
  const w = WIDTH / zoom;
  const h = HEIGHT / zoom;
  const any = { value: '', text: t('qolSearch.collections.any') };

  return (
    <Dialog
      title={t('qolSearch.graph.title')}
      description={t('qolSearch.graph.description')}
      size="large"
      actions={[{ id: 'close', label: t('common.close'), variant: 'secondary', onPress: onClose }]}
      onDismiss={onClose}
    >
      <div className={styles.controls}>
        <Pick
          label={t('qolSearch.graph.show')}
          value={scope}
          options={[
            ...(current ? [{ value: 'around', text: t('qolSearch.graph.around') }] : []),
            ...(workspace?.notebookId ? [{ value: 'notebook', text: t('qolSearch.graph.notebook') }] : []),
            { value: 'all', text: t('qolSearch.graph.all') },
          ]}
          onChange={(value) => setScope(value as Scope)}
        />
        {scope === 'around' && (
          <Pick
            label={t('qolSearch.graph.depth')}
            value={String(depth)}
            options={[1, 2, 3].map((n) => ({ value: String(n), text: t('qolSearch.graph.links', { count: n }) }))}
            onChange={(value) => setDepth(Number(value))}
          />
        )}
        <Pick
          label={t('qolSearch.collections.tag')}
          value={filter.tag}
          options={[any, ...tags.map((tag) => ({ value: tag, text: tag }))]}
          onChange={(tag) => setFilter({ ...filter, tag })}
        />
        <Pick
          label={t('qolSearch.collections.section')}
          value={filter.section}
          options={[any, ...sections.map((id) => ({ value: id, text: sectionNames.get(id) ?? id }))]}
          onChange={(section) => setFilter({ ...filter, section })}
        />
        <Pick
          label={t('qolSearch.collections.property')}
          value={filter.property}
          options={[any, ...names.map((name) => ({ value: name, text: name }))]}
          onChange={(property) => setFilter({ ...filter, property })}
        />
        {filter.property && (
          <TextField
            label={t('qolSearch.collections.value')}
            value={filter.propertyValue}
            onChange={(propertyValue) => setFilter({ ...filter, propertyValue })}
          />
        )}
        <div className={styles.zoom}>
          <Button
            variant="secondary"
            aria-label={t('qolSearch.graph.zoomIn')}
            onClick={() => setZoom((z) => Math.min(4, z * 1.4))}
          >
            +
          </Button>
          <Button
            variant="secondary"
            aria-label={t('qolSearch.graph.zoomOut')}
            onClick={() => setZoom((z) => Math.max(0.5, z / 1.4))}
          >
            −
          </Button>
        </div>
      </div>
      <p role="status" className={styles.note}>
        {graph === null
          ? t('qolSearch.collections.loading')
          : t('qolSearch.graph.summary', { pages: view.pages.length, links: view.edges.length })}
        {shown.pages.length > MAX_NODES ? ` ${t('qolSearch.graph.cut', { count: MAX_NODES })}` : ''}
      </p>
      <svg
        className={styles.canvas}
        viewBox={`${(WIDTH - w) / 2} ${(HEIGHT - h) / 2} ${w} ${h}`}
        role="img"
        aria-label={t('qolSearch.graph.picture', { pages: view.pages.length, links: view.edges.length })}
      >
        {view.edges.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={points[a].x}
            y1={points[a].y}
            x2={points[b].x}
            y2={points[b].y}
            className={styles.edge}
            data-hot={a === selectedAt || b === selectedAt ? 'true' : undefined}
          />
        ))}
        {view.pages.map((page, index) => {
          const isSelected = index === selectedAt;
          const label = isSelected || touching.has(index) || view.pages.length <= 30;
          const title = page.title || t('tree.page.noneTitle');
          return (
            <g
              key={page.page}
              className={styles.node}
              data-selected={isSelected ? 'true' : undefined}
              onClick={() => select(page.page)}
              onDoubleClick={() => open(page.page)}
            >
              <circle cx={points[index].x} cy={points[index].y} r={isSelected ? 9 : page.page === current ? 8 : 6} />
              {label && <text {...titleAt(points[index], title)}>{title}</text>}
            </g>
          );
        })}
      </svg>
      <section className={styles.connections} aria-label={t('qolSearch.graph.connections')}>
        <h3 className={styles.heading}>{t('qolSearch.graph.connections')}</h3>
        <Pick
          label={t('qolSearch.graph.pageLabel')}
          value={selected ?? ''}
          options={[
            { value: '', text: t('qolSearch.graph.choose') },
            ...view.pages.map((page) => ({ value: page.page, text: page.title || t('tree.page.noneTitle') })),
          ]}
          onChange={(value) => value && select(value)}
        />
        {selected && links && (
          <>
            <Button variant="secondary" onClick={() => open(selected)}>
              {t('qolSearch.graph.open', { title: titleOf(selected) })}
            </Button>
            {(['outgoing', 'incoming'] as const).map((direction) => (
              <div key={direction}>
                <h4 className={styles.sub}>{t(`qolSearch.graph.${direction}`, { count: links[direction].length })}</h4>
                <ul className={styles.list}>
                  {links[direction].map((link) => (
                    <li key={link.page}>
                      <button type="button" className={styles.link} onClick={() => select(link.page)}>
                        {link.title || t('tree.page.noneTitle')}
                      </button>{' '}
                      <span className={styles.muted}>{t('qolSearch.graph.times', { count: link.count })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
        <details>
          <summary>{t('qolSearch.graph.unlinked', { count: lonely.length })}</summary>
          <ul className={styles.list}>
            {lonely.map((page) => (
              <li key={page.page}>
                <button type="button" className={styles.link} onClick={() => open(page.page)}>
                  {page.title || t('tree.page.noneTitle')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </Dialog>
  );
}
