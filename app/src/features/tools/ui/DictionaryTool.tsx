// The dictionary and thesaurus (Study tools): type a word, or look up the word selected on the page, and see its meanings
// by part of speech with an example for each, and the words that mean the same. A synonym can replace the selected word
// on the page. It works offline from words kept on this device. English comes with the app; a dictionary for another
// language is added by choosing a file, and stays on this device.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { englishLoader } from '../dictionary/data';
import { lookupWord } from '../dictionary/lookup';
import { MAX_PACK_BYTES, browserPackStore, packLoader, readPackFile } from '../dictionary/packs';
import type { PackInfo, PackStore } from '../dictionary/packs';
import { wordRequest } from '../dictionary/request';
import type { Lookup } from '../dictionary/types';
import { INSERT_EVENT } from '../flags';
import styles from './tools.module.css';
import extra from './extra.module.css';

const ENGLISH = 'en';

/** Puts text into the page at the selection, replacing the selected word. Returns whether a page took it. */
function insertIntoPage(text: string): boolean {
  const detail = { text, handled: false };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail }));
  return detail.handled;
}

let shared: PackStore | null = null;
const packs = (): PackStore => (shared ??= browserPackStore());

export function DictionaryTool({ store = packs() }: { store?: PackStore }) {
  const request = useStore(wordRequest, (current) => current);
  const [text, setText] = useState(request.word);
  const [language, setLanguage] = useState(ENGLISH);
  const [added, setAdded] = useState<PackInfo[]>([]);
  const [found, setFound] = useState<Lookup | null>(null);
  const [searched, setSearched] = useState('');
  const [note, setNote] = useState('');
  const handled = useRef(request.count);

  useEffect(() => {
    let current = true;
    void store.list().then(
      (list) => current && setAdded(list),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [store]);

  // A word asked for from the page replaces what is typed.
  useEffect(() => {
    if (request.count !== handled.current) {
      handled.current = request.count;
      setText(request.word);
    }
  }, [request]);

  // The look-up follows the typing, a moment after the last key.
  useEffect(() => {
    const word = text.trim();
    if (word === '') {
      setFound(null);
      setSearched('');
      return undefined;
    }
    let current = true;
    const timer = setTimeout(() => {
      void (async () => {
        const loader =
          language === ENGLISH
            ? englishLoader
            : await store.get(language).then((pack) => (pack ? packLoader(pack) : englishLoader));
        const result = await lookupWord(word, loader);
        if (!current) return;
        setFound(result);
        setSearched(word);
        announce(
          result
            ? t('study.dictionary.found', { word: result.word, count: result.meanings.length })
            : t('study.dictionary.notFound', { word }),
        );
      })();
    }, 120);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, language, store, request.count]);

  const replace = (synonym: string) => {
    const ok = insertIntoPage(synonym);
    const message = t(ok ? 'study.dictionary.inserted' : 'study.dictionary.noPage', { word: synonym });
    setNote(message);
    announce(message);
  };

  const addFile = async (file: File) => {
    if (file.size > MAX_PACK_BYTES) return setNote(t('study.dictionary.packs.tooLarge'));
    const id = `pack${Date.now().toString(36)}`;
    const read = readPackFile(await file.text(), id);
    if ('problem' in read) return setNote(t(`study.dictionary.packs.${read.problem}`));
    await store.put(read.pack);
    setAdded(await store.list());
    setLanguage(id);
    const message = t('study.dictionary.packs.added', { name: read.pack.info.name, count: read.pack.info.words });
    setNote(message);
    announce(message);
  };

  const removePack = async (pack: PackInfo) => {
    await store.remove(pack.id);
    setAdded(await store.list());
    if (language === pack.id) setLanguage(ENGLISH);
    announce(t('study.dictionary.packs.removed', { name: pack.name }));
  };

  const headingId = 'dictionary-results';
  const showMissing = useMemo(() => text.trim() !== '' && searched !== '' && found === null, [text, searched, found]);

  return (
    <div className={styles.tool}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <TextField label={t('study.dictionary.word')} value={text} onChange={setText} />
        {added.length > 0 ? (
          <label className={extra.field}>
            {t('study.dictionary.language')}
            <select className={extra.input} value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value={ENGLISH}>{t('study.dictionary.english')}</option>
              {added.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </form>
      {text.trim() === '' ? <p className={styles.empty}>{t('study.dictionary.empty')}</p> : null}
      {showMissing ? (
        <p className={styles.empty} role="status">
          {t('study.dictionary.notFound', { word: searched })}
        </p>
      ) : null}
      {found ? (
        <section aria-labelledby={headingId} className={styles.group}>
          <h3 id={headingId} className={styles.groupTitle}>
            {found.word}
            {found.word !== found.query ? (
              <span className={styles.note}> {t('study.dictionary.baseForm', { query: found.query })}</span>
            ) : null}
          </h3>
          {found.meanings.map((meaning) => (
            <div key={meaning.pos} className={styles.group}>
              <h4 className={styles.groupTitle}>{t(`study.dictionary.pos.${meaning.pos}`)}</h4>
              <ol className={styles.items}>
                {meaning.senses.map((sense, index) => (
                  <li key={index} className={styles.item}>
                    <span className={styles.itemTitle}>
                      {sense.definition}
                      {sense.example ? <span className={styles.note}> “{sense.example}”</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {found.synonyms.length > 0 ? (
            <div className={styles.group}>
              <h4 className={styles.groupTitle}>{t('study.dictionary.synonyms')}</h4>
              <ul className={styles.items}>
                {found.synonyms.map((synonym) => (
                  <li key={synonym} className={styles.item}>
                    <span className={styles.itemTitle}>{synonym}</span>
                    <Button
                      variant="quiet"
                      aria-label={t('study.dictionary.insertNamed', { word: synonym })}
                      onClick={() => replace(synonym)}
                    >
                      {t('study.dictionary.insert')}
                    </Button>
                    <Button
                      variant="quiet"
                      aria-label={t('study.dictionary.lookUpNamed', { word: synonym })}
                      onClick={() => setText(synonym)}
                    >
                      {t('study.dictionary.lookUp')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      {note ? (
        <p className={styles.note} role="status">
          {note}
        </p>
      ) : null}
      <details className={styles.group}>
        <summary>{t('study.dictionary.packs.summary')}</summary>
        <div className={styles.form}>
          <p className={styles.note}>{t('study.dictionary.packs.help')}</p>
          <label className={extra.field}>
            {t('study.dictionary.packs.file')}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void addFile(file);
              }}
            />
          </label>
          <ul className={styles.items}>
            {added.map((pack) => (
              <li key={pack.id} className={styles.item}>
                <span className={styles.itemTitle}>{pack.name}</span>
                <span className={styles.itemDue}>
                  {t('study.dictionary.packs.size', {
                    words: pack.words,
                    size: Math.max(1, Math.round(pack.bytes / 1024)),
                  })}
                </span>
                <Button
                  variant="quiet"
                  aria-label={t('study.dictionary.packs.removeNamed', { name: pack.name })}
                  onClick={() => void removePack(pack)}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
          <p className={styles.note}>{t('study.dictionary.about')}</p>
        </div>
      </details>
    </div>
  );
}
