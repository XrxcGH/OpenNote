// The Citations window (Citation helper): the sources of the notebook, a style, and what to do with them. Sources are
// typed, imported from BibTeX, RIS, or Zotero, cited at the caret in the chosen style, or listed as a bibliography
// that can be put in the page or saved as text, BibTeX, or RIS. Looking up a DOI would use the network, so it is not
// offered: Work offline stays honest.
import { useState } from 'react';
import { useLocation } from '../../../app/location';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { INSERT_EVENT } from '../../tools/flags';
import { parseBibtex, parseRis, toBibtex, toRis } from '../bibtex';
import { SOURCE_TYPES, blankSource, parsePeople, personText } from '../model';
import type { Source, SourceType } from '../model';
import { addSources, removeSource, saveSource, setStyle, sourcesOf, sourcesStore, styleStore, SHARED } from '../store';
import { STYLES, STYLE_IDS, bibliography, bibliographyHtml } from '../styles';
import type { StyleId } from '../styles';
import { readZotero } from '../zotero';
import { saveText } from './save';
import styles from './citations.module.css';

function insertIntoPage(text: string): boolean {
  const detail = { text, handled: false };
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

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function CitationsPanel() {
  const location = useLocation();
  const notebook = location.view === 'workspace' && location.notebookId ? String(location.notebookId) : SHARED;
  useStore(sourcesStore, (current) => current[notebook]);
  const style = useStore(styleStore, (current) => current);
  const sources = sourcesOf(notebook);
  const [editing, setEditing] = useState<Source | null>(null);
  const [note, setNote] = useState('');
  const [paste, setPaste] = useState('');

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
    const ok = insertIntoPage(STYLES[style].inline(source, number));
    announce(t(ok ? 'study.citations.cited' : 'study.citations.noPage'));
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
          {STYLE_IDS.map((one) => (
            <option key={one} value={one}>
              {t(`study.citations.styles.${one}`)}
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
