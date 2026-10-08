// The Citations window (Citation helper): the sources of the notebook, a style, and what to do with them. Sources are
// typed, imported from BibTeX, RIS, or Zotero, cited at the caret in the chosen style, or listed as a bibliography
// that can be put in the page or saved as text, BibTeX, or RIS. A DOI or ISBN can be looked up on request: that is
// the one thing here that uses the network, so it waits for a press of the button, says which sites it asks, and
// never runs while Work offline is on. Citations and the bibliography can also go in as blocks that follow the style.
import { useState } from 'react';
import { useLocation } from '../../../app/location';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { isOffline } from '../../diagnostics';
import { INSERT_EVENT } from '../../tools/flags';
import { parseBibtex, parseRis, toBibtex, toRis } from '../bibtex';
import { SOURCE_TYPES, blankSource, parsePeople, personText } from '../model';
import type { Source, SourceType } from '../model';
import { readStyleFile } from '../csl';
import { LOOKUP_HOSTS, lookupSource } from '../lookup';
import {
  addStyle,
  addSources,
  removeSource,
  removeStyle,
  saveSource,
  setStyle,
  sourcesOf,
  sourcesStore,
  styleStore,
  SHARED,
} from '../store';
import { addedStyles, styleChoices } from '../styleList';
import { bibliography, bibliographyHtml, styleOf } from '../styles';
import type { StyleId } from '../styles';
import { readZotero } from '../zotero';
import { saveText } from './save';
import styles from './citations.module.css';

function insertIntoPage(text: string): boolean {
  const detail = { text, handled: false };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail }));
  return detail.handled;
}

/** Puts a citation or bibliography block into the page. The block names its sources, so a style change updates it. */
function insertBlock(type: 'citation' | 'bibliography', data: Record<string, unknown>, fallback: string): boolean {
  const detail = { block: { type, data, fallback }, handled: false };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail }));
  return detail.handled;
}

const FIELDS: readonly (keyof Source)[] = [
  'container',
  'publisher',
  'place',
  'edition',
  'volume',
  'issue',
  'pages',
  'url',
  'doi',
  'year',
  'month',
  'day',
  'accessed',
];
const BY_TYPE: Record<SourceType, readonly (keyof Source)[]> = {
  book: ['publisher', 'place', 'edition', 'year', 'doi', 'url'],
  article: ['container', 'volume', 'issue', 'pages', 'year', 'month', 'doi', 'url'],
  web: ['container', 'year', 'month', 'day', 'url', 'accessed'],
  recording: ['publisher', 'year', 'month', 'day', 'url'],
};

function SourceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Source;
  onSave(source: Source): void;
  onCancel(): void;
}) {
  const [source, setSource] = useState(initial);
  const [authors, setAuthors] = useState(initial.authors.map(personText).join('\n'));
  const shown = BY_TYPE[source.type];
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (source.title.trim() === '') return announce(t('study.citations.needTitle'));
        onSave({ ...source, title: source.title.trim(), authors: parsePeople(authors) });
      }}
    >
      <label className={styles.field}>
        {t('study.citations.type')}
        <select
          value={source.type}
          onChange={(event) => setSource({ ...source, type: event.target.value as SourceType })}
        >
          {SOURCE_TYPES.map((one) => (
            <option key={one} value={one}>
              {t(`study.citations.types.${one}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        {t('study.citations.fields.title')}
        <input
          type="text"
          value={source.title}
          onChange={(event) => setSource({ ...source, title: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        {t('study.citations.fields.authors')}
        <textarea value={authors} rows={3} onChange={(event) => setAuthors(event.target.value)} />
      </label>
      {FIELDS.filter((field) => shown.includes(field)).map((field) => (
        <label key={field} className={styles.field}>
          {t(`study.citations.fields.${field as 'container'}`)}
          <input
            type="text"
            value={source[field] as string}
            onChange={(event) => setSource({ ...source, [field]: event.target.value })}
          />
        </label>
      ))}
      <div className={styles.buttons}>
        <Button type="submit" variant="primary">
          {t('study.citations.save')}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t('study.edit.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function CitationsPanel() {
  const location = useLocation();
  const notebook = location.view === 'workspace' && location.notebookId ? String(location.notebookId) : SHARED;
  useStore(sourcesStore, (current) => current[notebook]);
  const style = useStore(styleStore, (current) => current);
  const added = useStore(addedStyles, (current) => current);
  const sources = sourcesOf(notebook);
  const [editing, setEditing] = useState<Source | null>(null);
  const [note, setNote] = useState('');
  const [paste, setPaste] = useState('');
  const [typedId, setTypedId] = useState('');
  const [found, setFound] = useState<Source | null>(null);
  const [looking, setLooking] = useState(false);

  const finishImport = (found: { sources: Source[]; skipped: number }) => {
    const result = addSources(notebook, found.sources);
    const text = t('study.citations.imported', {
      added: result.added,
      repeats: result.skipped,
      unreadable: found.skipped,
    });
    setNote(text);
    announce(text);
  };

  const importText = (text: string, name = '') => {
    const looksRis = /^TY {2}- /m.test(text) || /\.ris$/i.test(name);
    const found = looksRis ? parseRis(text) : parseBibtex(text);
    if (found.sources.length === 0 && found.skipped === 0) return setNote(t('study.citations.nothingFound'));
    finishImport(found);
  };

  const zotero = async () => {
    try {
      finishImport(await readZotero());
    } catch (error) {
      const code = error instanceof Error ? error.message : 'failed';
      setNote(
        t(
          code === 'off'
            ? 'study.citations.zoteroOff'
            : code === 'missing'
              ? 'study.citations.zoteroMissing'
              : 'study.citations.zoteroFailed',
        ),
      );
    }
  };

  const cite = (source: Source) => {
    const number = sources.findIndex((one) => one.id === source.id) + 1;
    const ok = insertIntoPage(styleOf(style).inline(source, number));
    announce(t(ok ? 'study.citations.cited' : 'study.citations.noPage'));
  };

  const lookUp = async () => {
    setLooking(true);
    setFound(null);
    const result = await lookupSource(typedId, undefined, isOffline);
    setLooking(false);
    if (result.ok) {
      setFound(result.source);
      setNote('');
      announce(t('study.citations.lookup.found', { title: result.source.title }));
      return;
    }
    const text = t(`study.citations.lookup.${result.reason}`);
    setNote(text);
    announce(text);
  };

  const citeLive = (source: Source) => {
    const ok = insertBlock(
      'citation',
      { notebook, source: source.id },
      styleOf(style).inline(source, sources.findIndex((one) => one.id === source.id) + 1),
    );
    announce(t(ok ? 'study.citations.live.inserted' : 'study.citations.noPage'));
  };

  const text = bibliography(sources, style);

  if (editing) {
    return (
      <div className={styles.root}>
        <SourceForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={(source) => {
            saveSource(notebook, source);
            setEditing(null);
            announce(t('study.citations.saved'));
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <label className={styles.field}>
        {t('study.citations.style')}
        <select value={style} onChange={(event) => setStyle(event.target.value as StyleId)}>
          {styleChoices().map((one) => (
            <option key={one.id} value={one.id}>
              {one.label}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.buttons}>
        <Button variant="primary" onClick={() => setEditing(blankSource())}>
          {t('study.citations.add')}
        </Button>
        <Button onClick={() => void zotero()}>{t('study.citations.fromZotero')}</Button>
      </div>
      {sources.length === 0 ? <p className={styles.muted}>{t('study.citations.none')}</p> : null}
      <ul className={styles.list}>
        {sources.map((source) => (
          <li key={source.id} className={styles.row}>
            <div className={styles.grow}>
              <div>{source.title}</div>
              <div className={styles.muted}>
                {[source.authors.map((person) => person.family).join(', '), source.year].filter(Boolean).join(' · ')}
              </div>
            </div>
            <Button
              variant="quiet"
              aria-label={t('study.citations.citeNamed', { title: source.title })}
              onClick={() => cite(source)}
            >
              {t('study.citations.cite')}
            </Button>
            <Button
              variant="quiet"
              aria-label={t('study.citations.live.citeNamed', { title: source.title })}
              onClick={() => citeLive(source)}
            >
              {t('study.citations.live.cite')}
            </Button>
            <Button
              variant="quiet"
              aria-label={t('study.citations.editNamed', { title: source.title })}
              onClick={() => setEditing(source)}
            >
              {t('study.citations.edit')}
            </Button>
            <Button
              variant="quiet"
              aria-label={t('study.citations.removeNamed', { title: source.title })}
              onClick={() => {
                removeSource(notebook, source.id);
                announce(t('study.citations.removed'));
              }}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
      {sources.length > 0 ? (
        <>
          <h3 className={styles.heading}>{t('study.citations.bibliography')}</h3>
          <div className={styles.preview} aria-label={t('study.citations.bibliography')}>
            {text}
          </div>
          <div className={styles.buttons}>
            <Button
              onClick={() =>
                announce(
                  t(
                    insertIntoPage(bibliographyHtml(sources, style))
                      ? 'study.citations.inserted'
                      : 'study.citations.noPage',
                  ),
                )
              }
            >
              {t('study.citations.insertBibliography')}
            </Button>
            <Button
              variant="quiet"
              onClick={() =>
                announce(
                  t(
                    insertBlock('bibliography', { notebook, sources: null }, text)
                      ? 'study.citations.live.bibliographyInserted'
                      : 'study.citations.noPage',
                  ),
                )
              }
            >
              {t('study.citations.live.insertBibliography')}
            </Button>
            <Button
              variant="quiet"
              onClick={() => void saveText('bibliography.txt', text, 'text/plain', t('study.citations.textLabel'))}
            >
              {t('study.citations.exportText')}
            </Button>
            <Button
              variant="quiet"
              onClick={() =>
                void saveText('sources.bib', toBibtex(sources), 'text/plain', t('study.citations.bibLabel'))
              }
            >
              {t('study.citations.exportBibtex')}
            </Button>
            <Button
              variant="quiet"
              onClick={() => void saveText('sources.ris', toRis(sources), 'text/plain', t('study.citations.risLabel'))}
            >
              {t('study.citations.exportRis')}
            </Button>
          </div>
        </>
      ) : null}
      <h3 className={styles.heading}>{t('study.citations.lookup.heading')}</h3>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (typedId.trim() !== '') void lookUp();
        }}
      >
        <label className={styles.field}>
          {t('study.citations.lookup.label')}
          <input type="text" value={typedId} autoComplete="off" onChange={(event) => setTypedId(event.target.value)} />
        </label>
        <p className={styles.muted}>{t('study.citations.lookup.help', { hosts: LOOKUP_HOSTS.join(', ') })}</p>
        <div className={styles.buttons}>
          <Button type="submit" disabled={looking || typedId.trim() === ''}>
            {t('study.citations.lookup.button')}
          </Button>
        </div>
      </form>
      {found ? (
        <div className={styles.row} role="group" aria-label={t('study.citations.lookup.result')}>
          <div className={styles.grow}>
            <div>{found.title}</div>
            <div className={styles.muted}>
              {[found.authors.map((person) => person.family).join(', '), found.year, found.container || found.publisher]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <Button
            onClick={() => {
              const result = addSources(notebook, [found]);
              setFound(null);
              setTypedId('');
              const text = t('study.citations.imported', {
                added: result.added,
                repeats: result.skipped,
                unreadable: 0,
              });
              setNote(text);
              announce(text);
            }}
          >
            {t('study.citations.lookup.add')}
          </Button>
          <Button variant="quiet" onClick={() => setFound(null)}>
            {t('study.citations.lookup.discard')}
          </Button>
        </div>
      ) : null}
      <h3 className={styles.heading}>{t('study.citations.styleFiles')}</h3>
      <p className={styles.muted}>{t('study.citations.styleFilesHelp')}</p>
      <label className={styles.field}>
        {t('study.citations.styleFile')}
        <input
          type="file"
          accept=".json,.csl.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void file.text().then((body) => {
              const read = readStyleFile(body);
              const message =
                'style' in read
                  ? addStyle(read.style)
                    ? t('study.citations.styleAdded', { name: read.style.title })
                    : t('study.citations.styleOwned', { name: read.style.title })
                  : read.error === 'not-json'
                    ? t('study.citations.style_notJson')
                    : read.error === 'shape'
                      ? t('study.citations.style_shape')
                      : t('study.citations.style_template', { problem: read.error });
              setNote(message);
              announce(message);
            });
          }}
        />
      </label>
      {added.length > 0 ? (
        <ul className={styles.list}>
          {added.map((file) => (
            <li key={file.id} className={styles.row}>
              <div className={styles.grow}>{file.title}</div>
              <Button
                variant="quiet"
                onClick={() => {
                  removeStyle(file.id);
                  announce(t('study.citations.styleRemoved', { name: file.title }));
                }}
              >
                {t('study.citations.styleRemove', { name: file.title })}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <h3 className={styles.heading}>{t('study.citations.import')}</h3>
      <label className={styles.field}>
        {t('study.citations.file')}
        <input
          type="file"
          accept=".bib,.bibtex,.ris,.txt"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void file.text().then((body) => importText(body, file.name));
          }}
        />
      </label>
      <label className={styles.field}>
        {t('study.citations.paste')}
        <textarea value={paste} rows={4} onChange={(event) => setPaste(event.target.value)} />
      </label>
      <div className={styles.buttons}>
        <Button
          disabled={paste.trim() === ''}
          onClick={() => {
            importText(paste);
            setPaste('');
          }}
        >
          {t('study.citations.importPasted')}
        </Button>
      </div>
      {note ? (
        <p className={styles.muted} role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
