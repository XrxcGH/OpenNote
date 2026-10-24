// The symbol palette: Greek letters and math, science, and engineering symbols. Search by name, by LaTeX name, or by
// the symbol itself. Recent symbols come first. Choosing a symbol puts it at the caret of the page that is open.
import { useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { SYMBOLS, SYMBOL_GROUPS, searchSymbols } from '../symbols/data';
import type { MathSymbol, SymbolGroup } from '../symbols/data';
import { pushRecent, readRecent, resetRecent } from '../symbols/recent';
import { insertIntoPage } from './CalculatorTool';
import extra from './extra.module.css';
import styles from './tools.module.css';

const BY_CHAR = new Map(SYMBOLS.map((symbol) => [symbol.char, symbol]));

export function SymbolsTool() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<SymbolGroup | null>(null);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const shown = useMemo(() => searchSymbols(query, group ?? undefined), [query, group]);
  const recentSymbols = recent.map((char) => BY_CHAR.get(char)).filter((one): one is MathSymbol => one !== undefined);

  const choose = (symbol: MathSymbol) => {
    if (!insertIntoPage({ text: symbol.char })) return announce(t('study.symbols.noPage'));
    setRecent(pushRecent(symbol.char));
    announce(t('study.symbols.inserted', { name: symbol.name }));
  };

  const cell = (symbol: MathSymbol) => (
    <Button
      key={symbol.char}
      variant="secondary"
      aria-label={t('study.symbols.pick', { name: symbol.name })}
      title={`${symbol.name}  \\${symbol.commands[0] ?? ''}`}
      onClick={() => choose(symbol)}
    >
      <span translate="no">{symbol.char}</span>
    </Button>
  );

  return (
    <div className={styles.toolFill}>
      <TextField label={t('study.symbols.search')} value={query} onChange={setQuery} />
      <p className={styles.empty}>{t('study.symbols.searchHelp')}</p>
      <div className={styles.tabs} role="group" aria-label={t('study.symbols.groups')}>
        {[null, ...SYMBOL_GROUPS].map((one) => (
          <button
            key={one ?? 'all'}
            type="button"
            aria-pressed={group === one}
            className={styles.tab}
            onClick={() => setGroup(one)}
          >
            {one ? t(`study.symbols.group.${one}`) : t('study.symbols.all')}
          </button>
        ))}
      </div>
      <section aria-label={t('study.symbols.recent')}>
        <h3>{t('study.symbols.recent')}</h3>
        {recentSymbols.length === 0 ? (
          <p className={styles.empty}>{t('study.symbols.recentNone')}</p>
        ) : (
          <>
            <div className={styles.keys} role="group" aria-label={t('study.symbols.recent')}>
              {recentSymbols.map((symbol) => cell(symbol))}
            </div>
            <Button
              variant="quiet"
              onClick={() => {
                resetRecent();
                setRecent([]);
                announce(t('study.symbols.recentCleared'));
              }}
            >
              {t('study.symbols.clearRecent')}
            </Button>
          </>
        )}
      </section>
      <p role="status">
        {shown.length === 0
          ? t('study.symbols.noMatch', { query: query.trim() })
          : t('study.symbols.count', { count: shown.length })}
      </p>
      <div className={`${styles.keys} ${extra.scroll}`} role="group" aria-label={t('study.symbols.grid')}>
        {shown.map((symbol) => cell(symbol))}
      </div>
    </div>
  );
}
