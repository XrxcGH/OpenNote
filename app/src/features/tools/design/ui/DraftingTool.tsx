// checks-disable-file modifiability: the sheet is one component that holds the drawing, its history, and the tool

// The drafting sheet: 2D engineering sketches with the usual line types, live dimensions that follow the geometry, a
// scale, dual units, and a title block. It is drafting paper with tools, not a CAD program. The picture goes into the
// page as an SVG, and every dimension goes in as a table or as text so the numbers stay searchable.
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Button, announce, openMenu } from '../../../../ui';
import { toSvg, type TitleLabels } from '../drafting/draw';
import { History, remove } from '../drafting/edit';
import {
  ALL_SNAPS,
  dimLines,
  fallbackText,
  readDoc,
  DRAWN_LINE_TYPES,
  emptyDoc,
  type DraftingDoc,
  type LineType,
  type Pt,
  type Snap,
  type SnapOptions,
} from '../drafting/model';
import {
  DRAFT_TOOLS,
  NOTHING,
  click,
  finishPoly,
  hintFor,
  placeNote,
  type DraftTool,
  type Pending,
  type StepResult,
} from '../drafting/tools';
import { pictureRequest, sendToPage } from './insert';
import { Contents, Selection, Settings, TitleBlock, TypedShape } from './DraftingPanels';
import { DraftingCanvas } from './DraftingCanvas';
import { say } from './ToolPanel';
import { load, save } from './store';
import styles from './design.module.css';

const KEY = 'drafting.doc';

function startDoc(): DraftingDoc {
  const saved = load<unknown>(KEY, null);
  if (saved) return readDoc(saved);
  const doc = emptyDoc();
  return {
    ...doc,
    title: { ...doc.title, scale: '1:1', sheet: '1 / 1', tolerance: say('kitDesign.drafting.defaultTolerance') },
  };
}

const titleLabels = (): TitleLabels => ({
  title: say('kitDesign.drafting.titleKeys.title'),
  drawnBy: say('kitDesign.drafting.titleKeys.drawnBy'),
  date: say('kitDesign.drafting.titleKeys.date'),
  scale: say('kitDesign.drafting.titleKeys.scale'),
  sheet: say('kitDesign.drafting.titleKeys.sheet'),
  material: say('kitDesign.drafting.titleKeys.material'),
  tolerance: say('kitDesign.drafting.titleKeys.tolerance'),
});

function textLabels() {
  const kinds = Object.fromEntries(
    ['linear', 'aligned', 'angular', 'radius', 'diameter'].map((k) => [k, say(`kitDesign.drafting.dimKinds.${k}`)]),
  ) as Record<'linear' | 'aligned' | 'angular' | 'radius' | 'diameter', string>;
  return { head: say('kitDesign.drafting.textHead'), none: say('kitDesign.drafting.textNone'), kinds };
}

export default function DraftingTool() {
  const [history] = useState(() => new History(startDoc()));
  const [, setTick] = useState(0);
  const doc = history.present;
  const [tool, setTool] = useState<DraftTool>('line');
  const [lineType, setLineType] = useState<LineType>('visible');
  const [pending, setPending] = useState<Pending>(NOTHING);
  const [cursor, setCursor] = useState<Snap | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<SnapOptions>(ALL_SNAPS);
  const [zoom, setZoom] = useState(1);
  const [noteAt, setNoteAt] = useState<Pt | null>(null);
  const [noteText, setNoteText] = useState('');
  const [message, setMessage] = useState('');

  const commit = (next: DraftingDoc) => {
    history.push(next);
    save(KEY, next);
    setTick((n) => n + 1);
  };
  const tell = (text: string) => {
    setMessage(text);
    announce(text);
  };
  const apply = (result: StepResult) => {
    setPending(result.pending);
    if (result.doc) {
      commit(result.doc);
      tell(say('kitDesign.drafting.added'));
    }
    if (result.selected !== undefined) setSelected(result.selected);
    if (result.noteAt) {
      setNoteAt(result.noteAt);
      setNoteText('');
    }
    if (result.problem) tell(say(`kitDesign.drafting.problem.${result.problem}`));
  };
  const chooseTool = (next: DraftTool) => {
    setTool(next);
    setPending(NOTHING);
    setNoteAt(null);
    tell(say('kitDesign.drafting.toolChosen', { tool: say(`kitDesign.drafting.tools.${next}`) }));
  };
  const onPoint = (p: Pt, reach: number) => {
    apply(click(tool, pending, p, doc, { lt: lineType, reach }));
  };
  const undo = () => {
    history.undo();
    save(KEY, history.present);
    setPending(NOTHING);
    setTick((n) => n + 1);
    tell(say('kitDesign.drafting.undone'));
  };
  const redo = () => {
    history.redo();
    save(KEY, history.present);
    setTick((n) => n + 1);
    tell(say('kitDesign.drafting.redone'));
  };
  const finish = (closed: boolean) => apply(finishPoly(pending, doc, lineType, closed));
  const deleteSelected = () => {
    if (!selected) return;
    commit(remove(doc, selected));
    setSelected(null);
    tell(say('kitDesign.drafting.deleted'));
  };
  const onKey = (event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      setPending(NOTHING);
      setNoteAt(null);
    } else if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Enter' && tool === 'poly') {
      event.preventDefault();
      finish(false);
    }
  };

  const lines = useMemo(() => dimLines(doc), [doc]);
  const description = say('kitDesign.drafting.alt', { shapes: doc.entities.length, dims: lines.length });

  const request = (kind: 'picture' | 'table' | 'text'): Parameters<typeof sendToPage>[0] => {
    if (kind === 'picture') {
      const svg = toSvg(doc, titleLabels(), description);
      return { picture: pictureRequest(svg, 'drawing.svg', description) };
    }
    if (kind === 'table') {
      const header = ['n', 'kind', 'value'].map((c) => say(`kitDesign.drafting.dimCol.${c}`));
      const rows = lines
        .filter((l) => !l.problem)
        .map((l, i) => [String(i + 1), say(`kitDesign.drafting.dimKinds.${l.kind}`), l.text]);
      return { table: { header, rows } };
    }
    return { text: `${fallbackText(doc, textLabels())} ` };
  };
  const put = (kind: 'picture' | 'table' | 'text') => {
    announce(say(sendToPage(request(kind)) ? 'kitDesign.ui.inserted' : 'kitDesign.ui.noPage'));
  };
  const openInsert = (anchor: HTMLElement) =>
    void openMenu({
      label: say('kitDesign.ui.insertMenu'),
      anchor,
      items: [
        { id: 'picture', label: say('kitDesign.drafting.insertPicture'), onSelect: () => put('picture') },
        { id: 'table', label: say('kitDesign.drafting.insertTable'), onSelect: () => put('table') },
        { id: 'text', label: say('kitDesign.drafting.insertText'), onSelect: () => put('text') },
      ],
    });

  return (
    <div className={styles.panel}>
      <p className={styles.hint}>{say('kitDesign.drafting.about')}</p>
      <div className={styles.toolbar} role="radiogroup" aria-label={say('kitDesign.drafting.toolbar')}>
        {DRAFT_TOOLS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tool === id}
            className={`${styles.tab} ${tool === id ? styles.toolOn : ''}`}
            onClick={() => chooseTool(id)}
          >
            {say(`kitDesign.drafting.tools.${id}`)}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{say('kitDesign.drafting.lineType')}</span>
          <select
            className={styles.input}
            value={lineType}
            onChange={(event) => setLineType(event.target.value as LineType)}
          >
            {DRAWN_LINE_TYPES.map((id) => (
              <option key={id} value={id}>
                {say(`kitDesign.drafting.lineTypes.${id}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{say('kitDesign.drafting.zoom')}</span>
          <select className={styles.input} value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
            {[1, 1.5, 2, 3].map((z) => (
              <option key={z} value={z}>
                {`${z * 100}%`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.buttons}>
        <Button onClick={undo} disabled={!history.canUndo}>
          {say('kitDesign.drafting.undo')}
        </Button>
        <Button onClick={redo} disabled={!history.canRedo}>
          {say('kitDesign.drafting.redo')}
        </Button>
        {tool === 'poly' && pending.pts.length > 0 && (
          <>
            <Button onClick={() => finish(false)}>{say('kitDesign.drafting.finishPoly')}</Button>
            <Button onClick={() => finish(true)}>{say('kitDesign.drafting.closePoly')}</Button>
          </>
        )}
        <Button variant="primary" aria-haspopup="menu" onClick={(event) => openInsert(event.currentTarget)}>
          {say('kitDesign.ui.insert')}
        </Button>
      </div>
      <p className={styles.hint} aria-live="off">
        {say(`kitDesign.drafting.hint.${hintFor(tool, pending)}`)}
      </p>
      <DraftingCanvas
        doc={doc}
        tool={tool}
        pending={pending}
        cursor={cursor}
        selected={selected}
        lineType={lineType}
        snaps={snaps}
        zoom={zoom}
        labels={titleLabels()}
        description={description}
        onPoint={onPoint}
        onHover={setCursor}
        onKey={onKey}
      />
      {cursor && (
        <p className={`${styles.hint} ${styles.number}`}>
          {say(`kitDesign.drafting.snapKinds.${cursor.kind}`)}{' '}
          {say('kitDesign.drafting.position', { x: cursor.p[0].toFixed(1), y: cursor.p[1].toFixed(1) })}
        </p>
      )}
      <p role="status" className={styles.hint}>
        {message}
      </p>
      {noteAt && (
        <form
          className={styles.row}
          onSubmit={(event) => {
            event.preventDefault();
            apply(placeNote(doc, noteAt, noteText));
            setNoteAt(null);
          }}
        >
          <label className={styles.field}>
            <span>{say('kitDesign.drafting.noteText')}</span>
            <input
              type="text"
              className={styles.input}
              value={noteText}
              maxLength={80}
              autoFocus
              onChange={(event) => setNoteText(event.target.value)}
            />
          </label>
          <Button type="submit" variant="primary">
            {say('kitDesign.drafting.addNote')}
          </Button>
        </form>
      )}
      {selected && <Selection doc={doc} id={selected} onDoc={commit} onSelect={setSelected} />}
      <Contents doc={doc} selected={selected} onSelect={(id) => setSelected(id)} />
      <TypedShape
        doc={doc}
        lineType={lineType}
        onAdd={(next, id) => {
          commit(next);
          setSelected(id);
          tell(say('kitDesign.drafting.added'));
        }}
        onProblem={(p) => tell(say(`kitDesign.drafting.problem.${p === 'full' ? 'full' : 'tooSmall'}`))}
      />
      <Settings doc={doc} snaps={snaps} onDoc={commit} onSnaps={setSnaps} />
      <TitleBlock doc={doc} onDoc={commit} />
      <div className={styles.buttons}>
        <Button
          onClick={() => {
            commit({
              ...emptyDoc(doc.units, doc.sheet),
              title: doc.title,
              scale: doc.scale,
              decimals: doc.decimals,
              dual: doc.dual,
            });
            setSelected(null);
            tell(say('kitDesign.drafting.cleared'));
          }}
        >
          {say('kitDesign.drafting.clear')}
        </Button>
      </div>
    </div>
  );
}
