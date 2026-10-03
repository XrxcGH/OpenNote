// The canvas of the open page: an open board of cards (pages, notes, images, PDFs, web addresses, and groups)
// joined by labeled arrows. Cards move by dragging or with the arrow keys, Enter opens one, and the Connect form
// makes arrows without a pointer. The board is saved in the page, so it goes wherever the notebook goes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useLocation } from '../../app/location';
import { commandContext } from '../../commands/registry';
import { newId } from '../../editor/ids';
import type { OpenPage } from '../../services/pages/types';
import type { PageSuggestion } from '../../services/search/types';
import type { NodeId } from '../../services/notes/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Button, Dialog, TextField, announce, showToast } from '../../ui';
import { maybeSearchClient, openAndReveal } from '../search';
import styles from './canvas.module.css';
import { CARD_KINDS, CARD_SIZE, align, cardKind, cardText, center, edgePoint, emptyCanvas, exportJson, importJson, pageOf, place, readCanvas, removeCards, viewPatch } from './model';
import type { Alignment, Canvas, CanvasNode, CardKind } from './model';

const WEB = /^https?:\/\//i;

function Pick({ label, value, options, onChange }: { label: string; value: string; options: { value: string; text: string }[]; onChange(value: string): void }) {
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

export default function CanvasView({ onClose }: OverlayProps) {
  const here = useLocation();
  const pageId = here.view === 'workspace' ? here.pageId : null;
  const [canvas, setCanvas] = useState<Canvas>(emptyCanvas);
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [kind, setKind] = useState<CardKind>('note');
  const [entry, setEntry] = useState('');
  const [found, setFound] = useState<PageSuggestion[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const [json, setJson] = useState('');
  const open = useRef<OpenPage | null>(null);
  const latest = useRef(canvas);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    void open.current?.send({ edits: [{ edit: 'setPage', view: viewPatch(latest.current) }] }).catch(() => undefined);
  }, []);
  const change = useCallback(
    (next: Canvas, now = true) => {
      latest.current = next;
      setCanvas(next);
      if (timer.current) clearTimeout(timer.current);
      if (now) send();
      else timer.current = setTimeout(send, 400);
    },
    [send],
  );

  useEffect(() => {
    if (!pageId) return;
    let live = true;
    void commandContext('palette')
      .platform.pages.open(pageId, { viewport: null })
      .then((page) => {
        if (!live) return void page.close();
        open.current = page;
        const loaded = readCanvas(page.initial.view);
        latest.current = loaded;
        setCanvas(loaded);
        setReady(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (timer.current) send();
      void open.current?.close();
      open.current = null;
    };
  }, [pageId, send]);

  useEffect(() => {
    const { notes } = commandContext('palette');
    const ids = canvas.nodes.map(pageOf).filter((id): id is string => id !== null && !titles.has(id));
    if (ids.length === 0) return;
    void Promise.all(ids.map((id) => notes.get(id as NodeId))).then((nodes) =>
      setTitles((was) => new Map([...was, ...nodes.flatMap((node, at) => (node ? [[ids[at], node.title] as const] : []))])),
    );
  }, [canvas.nodes, titles]);

  useEffect(() => {
    const client = maybeSearchClient();
    if (kind !== 'page' || entry.trim() === '' || !client) return setFound([]);
    let live = true;
    const timeout = setTimeout(() => void client.suggestPages(entry, 5).then((list) => live && setFound(list)).catch(() => undefined), 150);
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [kind, entry]);

  const add = (node: Pick<CanvasNode, 'type'> & Partial<CanvasNode>) => {
    const created: CanvasNode = { id: newId(), ...place(canvas), ...CARD_SIZE, ...node };
    change({ ...canvas, nodes: [...canvas.nodes, created] });
    setEntry('');
    setFound([]);
    announce(t('qolSearch.canvas.added'));
  };
  const addFromEntry = () => {
    const value = entry.trim();
    if (kind === 'note') add({ type: 'text', text: value || t('qolSearch.canvas.newNote') });
    else if (kind === 'group') add({ type: 'group', label: value || t('qolSearch.canvas.newGroup'), width: 360, height: 220 });
    else if (kind === 'web' && value) add({ type: 'link', url: WEB.test(value) ? value : `https://${value}` });
    else if ((kind === 'image' || kind === 'pdf') && value) add({ type: 'file', file: value });
  };
  const pick = (page: PageSuggestion) => add({ type: 'file', file: `opennote://page/${page.page}`, label: page.title });

  const move = (id: string, dx: number, dy: number, now = true) =>
    change({ ...canvas, nodes: canvas.nodes.map((node) => (node.id === id ? { ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy) } : node)) }, now);
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);
  const onDown = (event: PointerEvent<HTMLElement>, node: CanvasNode) => {
    if ((event.target as HTMLElement).closest('button, textarea, input')) return;
    drag.current = { id: node.id, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection((was) => (event.shiftKey || event.ctrlKey ? (was.includes(node.id) ? was.filter((id) => id !== node.id) : [...was, node.id]) : [node.id]));
  };
  const onMove = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    move(d.id, event.clientX - d.x, event.clientY - d.y, false);
    d.x = event.clientX;
    d.y = event.clientY;
  };
  const onUp = () => {
    if (drag.current) send();
    drag.current = null;
  };

  const openCard = (node: CanvasNode) => {
    const target = cardKind(node);
    const page = pageOf(node);
    if (page) {
      onClose();
      void openAndReveal(commandContext('palette').notes, page, null);
    } else if (node.url && WEB.test(node.url)) {
      void commandContext('palette').platform.shell.openExternal({ kind: 'link', url: node.url });
    } else if (target === 'image' || target === 'pdf') {
      const address = node.file ?? '';
      if (WEB.test(address)) void commandContext('palette').platform.shell.openExternal({ kind: 'link', url: address });
    }
  };
  const onKey = (event: KeyboardEvent<HTMLElement>, node: CanvasNode) => {
    if ((event.target as HTMLElement).closest('textarea, input')) return;
    const step = event.shiftKey ? 50 : 10;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = arrows[event.key];
    if (delta) {
      event.preventDefault();
      move(node.id, delta[0], delta[1], false);
    } else if (event.key === 'Enter') openCard(node);
    else if (event.key === ' ') {
      event.preventDefault();
      setSelection((was) => (was.includes(node.id) ? was.filter((id) => id !== node.id) : [...was, node.id]));
    } else if (event.key === 'Delete') {
      change(removeCards(canvas, [node.id]));
      announce(t('qolSearch.canvas.removed'));
    }
  };
  const editText = (node: CanvasNode, value: string) =>
    change(
      { ...canvas, nodes: canvas.nodes.map((n) => (n.id !== node.id ? n : n.type === 'text' ? { ...n, text: value } : n.type === 'link' ? { ...n, url: value } : { ...n, label: value })) },
      false,
    );
  const names = useMemo(() => new Map(canvas.nodes.map((node) => [node.id, cardText(node, titles) || t(`qolSearch.canvas.kinds.${cardKind(node)}`)])), [canvas.nodes, titles]);

  const connect = () => {
    if (!from || !to || from === to) return;
    change({ ...canvas, edges: [...canvas.edges, { id: newId(), fromNode: from, toNode: to, toEnd: 'arrow', ...(label.trim() ? { label: label.trim() } : {}) }] });
    setLabel('');
    announce(t('qolSearch.canvas.connected', { from: names.get(from) ?? '', to: names.get(to) ?? '' }));
  };
  const lineUp = (mode: Alignment) => change(align(canvas, selection, mode));

  const width = Math.max(900, ...canvas.nodes.map((node) => node.x + node.width + 80));
  const height = Math.max(420, ...canvas.nodes.map((node) => node.y + node.height + 80));
  const nodeOf = (id: string) => canvas.nodes.find((node) => node.id === id);
  const cards = canvas.nodes.map((node) => ({ id: node.id, text: names.get(node.id) ?? '' }));
  const cardOptions = [{ value: '', text: t('qolSearch.canvas.chooseCard') }, ...cards.map((card) => ({ value: card.id, text: card.text.slice(0, 60) }))];

  return (
    <Dialog
      title={t('qolSearch.canvas.title')}
      description={t('qolSearch.canvas.description')}
      size="large"
      actions={[{ id: 'close', label: t('common.close'), variant: 'secondary', onPress: onClose }]}
      onDismiss={onClose}
    >
      {!pageId && <p className={styles.note}>{t('qolSearch.canvas.noPage')}</p>}
      {pageId && !ready && <p className={styles.note}>{t('qolSearch.collections.loading')}</p>}
      {pageId && ready && (
        <>
          <div className={styles.tools}>
            <Pick label={t('qolSearch.canvas.addKind')} value={kind} options={CARD_KINDS.map((value) => ({ value, text: t(`qolSearch.canvas.kinds.${value}`) }))} onChange={(value) => { setKind(value as CardKind); setEntry(''); }} />
            <TextField label={t(`qolSearch.canvas.entry.${kind}`)} value={entry} onChange={setEntry} onCommit={addFromEntry} />
            {kind !== 'page' && (
              <Button variant="secondary" onClick={addFromEntry}>
                {t('qolSearch.canvas.add')}
              </Button>
            )}
          </div>
          {found.length > 0 && (
            <ul className={styles.found} aria-label={t('qolSearch.properties.pages')}>
              {found.map((page) => (
                <li key={page.page}>
                  <button type="button" className={styles.link} onClick={() => pick(page)}>
                    {page.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.tools}>
            <Pick label={t('qolSearch.canvas.from')} value={from} options={cardOptions} onChange={setFrom} />
            <Pick label={t('qolSearch.canvas.to')} value={to} options={cardOptions} onChange={setTo} />
            <TextField label={t('qolSearch.canvas.arrowLabel')} value={label} onChange={setLabel} onCommit={connect} />
            <Button variant="secondary" disabled={!from || !to || from === to} onClick={connect}>
              {t('qolSearch.canvas.connect')}
            </Button>
          </div>
          <div className={styles.tools} role="group" aria-label={t('qolSearch.canvas.arrange')}>
            {(['row', 'column', 'grid'] as const).map((mode) => (
              <Button key={mode} variant="secondary" disabled={selection.length < 2} onClick={() => lineUp(mode)}>
                {t(`qolSearch.canvas.align.${mode}`)}
              </Button>
            ))}
            <Button variant="quiet" disabled={selection.length === 0} onClick={() => { change(removeCards(canvas, selection)); setSelection([]); }}>
              {t('qolSearch.canvas.deleteSelected')}
            </Button>
            <span className={styles.note}>{t('qolSearch.canvas.selected', { count: selection.length })}</span>
          </div>
          <div className={styles.board}>
            <div className={styles.surface} style={{ inlineSize: width, blockSize: height }}>
              <svg className={styles.arrows} width={width} height={height} aria-hidden="true">
                <defs>
                  <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
                  </marker>
                </defs>
                {canvas.edges.map((edge) => {
                  const a = nodeOf(edge.fromNode);
                  const b = nodeOf(edge.toNode);
                  if (!a || !b) return null;
                  const p = edgePoint(a, center(b));
                  const q = edgePoint(b, center(a));
                  return (
                    <g key={edge.id}>
                      <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} markerEnd="url(#canvas-arrow)" />
                      {edge.label && (
                        <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 4} textAnchor="middle">
                          {edge.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              {canvas.nodes.map((node) => {
                const type = cardKind(node);
                const text = names.get(node.id) ?? '';
                const chosen = selection.includes(node.id);
                return (
                  <div
                    key={node.id}
                    className={styles.card}
                    data-kind={type}
                    data-selected={chosen ? 'true' : undefined}
                    role="group"
                    tabIndex={0}
                    aria-label={`${t(`qolSearch.canvas.kinds.${type}`)}: ${text}${chosen ? `, ${t('qolSearch.canvas.chosen')}` : ''}`}
                    style={{ insetInlineStart: node.x, insetBlockStart: node.y, inlineSize: node.width, blockSize: node.height }}
                    onPointerDown={(event) => onDown(event, node)}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onKeyDown={(event) => onKey(event, node)}
                  >
                    <span className={styles.kind}>{t(`qolSearch.canvas.kinds.${type}`)}</span>
                    {editing === node.id && type !== 'page' ? (
                      <textarea className={styles.edit} aria-label={t('qolSearch.canvas.editText')} value={type === 'note' ? (node.text ?? '') : type === 'web' ? (node.url ?? '') : (node.label ?? '')} onChange={(event) => editText(node, event.target.value)} onBlur={() => { send(); setEditing(null); }} autoFocus />
                    ) : (
                      <span className={styles.text}>{text}</span>
                    )}
                    <span className={styles.actions}>
                      {(type === 'page' || type === 'web' || WEB.test(node.file ?? '')) && (
                        <button type="button" className={styles.link} onClick={() => openCard(node)}>
                          {t('qolSearch.canvas.open')}
                        </button>
                      )}
                      {type !== 'page' && type !== 'image' && type !== 'pdf' && (
                        <button type="button" className={styles.link} onClick={() => setEditing(node.id)}>
                          {t('qolSearch.canvas.edit')}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <details className={styles.json}>
            <summary>{t('qolSearch.canvas.jsonTitle')}</summary>
            <textarea className={styles.edit} rows={5} aria-label={t('qolSearch.canvas.jsonTitle')} value={json} onChange={(event) => setJson(event.target.value)} />
            <div className={styles.tools}>
              <Button variant="secondary" onClick={() => setJson(exportJson(canvas))}>
                {t('qolSearch.canvas.export')}
              </Button>
              <Button
                variant="secondary"
                disabled={json.trim() === ''}
                onClick={() => {
                  const imported = importJson(json);
                  if (imported) change(imported);
                  else showToast({ message: t('qolSearch.canvas.importFailed'), tone: 'danger' });
                }}
              >
                {t('qolSearch.canvas.import')}
              </Button>
            </div>
          </details>
        </>
      )}
    </Dialog>
  );
}
