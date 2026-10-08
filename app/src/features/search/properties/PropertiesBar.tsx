// checks-disable-file modifiability: one dialog whose parts share its state; split it when it grows again
// The properties header of a page: a button that folds a list of typed fields open or shut. Each field shows an icon
// and its name, so no field is told apart by an icon alone. Changes are saved to the page as they are made.
import { CalendarBlankIcon } from '@phosphor-icons/react/dist/csr/CalendarBlank';
import { CaretCircleDownIcon } from '@phosphor-icons/react/dist/csr/CaretCircleDown';
import { CheckSquareIcon } from '@phosphor-icons/react/dist/csr/CheckSquare';
import { HashIcon } from '@phosphor-icons/react/dist/csr/Hash';
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple';
import { SlidersIcon } from '@phosphor-icons/react/dist/csr/Sliders';
import { TextTIcon } from '@phosphor-icons/react/dist/csr/TextT';
import type { ComponentType } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newId } from '../../../editor/ids';
import type { OpenPage } from '../../../services/pages/types';
import type { PageSuggestion } from '../../../services/search/types';
import { t } from '../../../strings/t';
import { Button, TextField } from '../../../ui';
import type { IconProps } from '../../../ui/icons';
import { maybeSearchClient } from '../client';
import { FIELD_TYPES, readFields, viewPatch } from './model';
import type { Field, FieldType } from './model';
import styles from './properties.module.css';

const ICONS: Record<FieldType, ComponentType<IconProps>> = {
  text: TextTIcon,
  number: HashIcon,
  date: CalendarBlankIcon,
  checkbox: CheckSquareIcon,
  choice: CaretCircleDownIcon,
  page: LinkSimpleIcon,
};
const FOLD_KEY = 'opennote.properties.open';

function readFold(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === 'true';
  } catch {
    return false;
  }
}

function PageLink({ field, onChange }: { field: Field; onChange(patch: Partial<Field>): void }) {
  const [text, setText] = useState(field.label ?? '');
  const [found, setFound] = useState<PageSuggestion[]>([]);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      const client = maybeSearchClient();
      if (!client || text.trim() === '' || text === field.label) return setFound([]);
      client
        .suggestPages(text, 5)
        .then((list) => current && setFound(list))
        .catch(() => undefined);
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, field.label]);
  return (
    <div className={styles.linkField}>
      <TextField label={field.name} value={text} onChange={setText} />
      {found.length > 0 && (
        <ul className={styles.suggestions} aria-label={t('qolSearch.properties.pages')}>
          {found.map((page) => (
            <li key={page.page}>
              <button
                type="button"
                className={styles.suggestion}
                onClick={() => {
                  onChange({ value: page.page, label: page.title });
                  setText(page.title);
                  setFound([]);
                }}
              >
                {page.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Value({ field, onChange }: { field: Field; onChange(patch: Partial<Field>): void }) {
  switch (field.type) {
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className={styles.check}
          checked={field.value === true}
          aria-label={field.name}
          onChange={(event) => onChange({ value: event.target.checked })}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className={styles.input}
          aria-label={field.name}
          value={typeof field.value === 'number' ? field.value : ''}
          onChange={(event) => onChange({ value: event.target.value === '' ? null : Number(event.target.value) })}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className={styles.input}
          aria-label={field.name}
          value={typeof field.value === 'string' ? field.value : ''}
          onChange={(event) => onChange({ value: event.target.value || null })}
        />
      );
    case 'choice':
      return (
        <select
          className={styles.input}
          aria-label={field.name}
          value={typeof field.value === 'string' ? field.value : ''}
          onChange={(event) => onChange({ value: event.target.value || null })}
        >
          <option value="">{t('qolSearch.properties.none')}</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case 'page':
      return <PageLink field={field} onChange={onChange} />;
    default:
      return (
        <input
          type="text"
          className={styles.input}
          aria-label={field.name}
          value={typeof field.value === 'string' ? field.value : ''}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      );
  }
}

export function PropertiesBar({ page }: { page: OpenPage }) {
  const [fields, setFields] = useState<Field[]>(() => readFields(page.initial.view));
  const [open, setOpen] = useState(readFold);
  const [adding, setAdding] = useState<FieldType>('text');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(fields);

  useEffect(
    () =>
      page.onFrame((frame) => {
        const view = frame.page?.view;
        if (view && 'properties' in view) {
          const next = readFields(view);
          latest.current = next;
          setFields(next);
        }
      }),
    [page],
  );

  const save = useCallback(
    (next: Field[], now = false) => {
      latest.current = next;
      setFields(next);
      if (timer.current) clearTimeout(timer.current);
      const send = () =>
        void page.send({ edits: [{ edit: 'setPage', view: viewPatch(latest.current) }] }).catch(() => undefined);
      if (now) send();
      else timer.current = setTimeout(send, 500);
    },
    [page],
  );
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void page.send({ edits: [{ edit: 'setPage', view: viewPatch(latest.current) }] }).catch(() => undefined);
      }
    },
    [page],
  );

  const toggle = () => {
    setOpen((was) => {
      try {
        localStorage.setItem(FOLD_KEY, String(!was));
      } catch {
        // The fold lasts for this page view only.
      }
      return !was;
    });
  };
  const change = (id: string, patch: Partial<Field>, now = false) =>
    save(
      latest.current.map((field) => (field.id === id ? { ...field, ...patch } : field)),
      now,
    );
  const add = () => {
    const name = t(`qolSearch.properties.types.${adding}`);
    const field: Field = { id: newId(), name, type: adding, value: adding === 'checkbox' ? false : null };
    if (adding === 'choice') field.options = [t('qolSearch.properties.firstChoice')];
    save([...latest.current, field], true);
  };

  return (
    <section className={styles.bar} aria-label={t('qolSearch.properties.title')}>
      <button type="button" className={styles.fold} aria-expanded={open} onClick={toggle}>
        <SlidersIcon aria-hidden={true} />
        {t('qolSearch.properties.title')}
        <span className={styles.count}>{t('qolSearch.properties.count', { count: fields.length })}</span>
      </button>
      {open && (
        <div className={styles.panel}>
          {fields.length === 0 && <p className={styles.note}>{t('qolSearch.properties.empty')}</p>}
          {fields.map((field) => {
            const Icon = ICONS[field.type];
            return (
              <div key={field.id} className={styles.row}>
                <span className={styles.name}>
                  <Icon aria-hidden={true} />
                  <input
                    className={styles.nameInput}
                    aria-label={t('qolSearch.properties.nameOf', {
                      type: t(`qolSearch.properties.types.${field.type}`),
                    })}
                    value={field.name}
                    onChange={(event) => change(field.id, { name: event.target.value })}
                  />
                </span>
                <Value
                  field={field}
                  onChange={(patch) => change(field.id, patch, field.type !== 'text' && field.type !== 'number')}
                />
                {field.type === 'choice' && (
                  <input
                    className={styles.input}
                    aria-label={t('qolSearch.properties.optionsOf', { name: field.name })}
                    placeholder={t('qolSearch.properties.optionsHint')}
                    defaultValue={(field.options ?? []).join(', ')}
                    onChange={(event) =>
                      change(field.id, {
                        options: event.target.value
                          .split(',')
                          .map((option) => option.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                )}
                <Button
                  variant="quiet"
                  aria-label={t('qolSearch.properties.remove', { name: field.name })}
                  onClick={() =>
                    save(
                      latest.current.filter((other) => other.id !== field.id),
                      true,
                    )
                  }
                >
                  {t('qolSearch.properties.removeShort')}
                </Button>
              </div>
            );
          })}
          <div className={styles.adder}>
            <select
              className={styles.input}
              aria-label={t('qolSearch.properties.type')}
              value={adding}
              onChange={(event) => setAdding(event.target.value as FieldType)}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`qolSearch.properties.types.${type}`)}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={add}>
              {t('qolSearch.properties.add')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
