// The formula sheet builder (flag doc.formulaSheet): collects the display equations of the shown page, the selected
// pages, or the whole section into a new page laid out as a table that fits one sheet. The sheet can then be turned
// into the person's own writing with My handwriting.
import { useState } from 'react';
import { executeCommand } from '../../../commands/registry';
import { newId } from '../../../editor/ids';
import { newTableData } from '../../../editor/table/mapping';
import type { NewBlock } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { Button, RadioCard, RadioGroup, Switch, announce, showToast } from '../../../ui';
import { buildSheet, collectFormulas } from '../formulaSheet';
import type { SheetPage } from '../formulaSheet';
import { pageTexts, sectionPages, selectedPages, shownPage } from '../pageText';
import { isEnabled } from '../../../app/flags';
import { loadTemplates, targetEditor } from '../../page';
import docs from './docTools.module.css';

type Source = 'current' | 'selected' | 'section';

async function gather(source: Source): Promise<SheetPage[]> {
  if (source === 'current') {
    const page = await shownPage();
    return page ? [page] : [];
  }
  const chosen = source === 'selected' ? selectedPages() : sectionPages();
  return Promise.all(chosen.map((p) => pageTexts(p.id, p.title)));
}

/** The sheet as a table block, wide enough for the page, with a column for each layout column. */
function tableBlock(rows: readonly (readonly string[])[], columns: number): NewBlock {
  const data = newTableData(columns, rows.length, false);
  const width = Math.floor(720 / columns);
  data.columns.forEach((column) => (column.width = width));
  data.rows.forEach((row, r) =>
    data.columns.forEach((column, c) => {
      row.cells[column.id] = { markdown: rows[r][c] ?? '' };
    }),
  );
  return { id: newId(), type: 'table', data: { ...data } };
}

/** Selects the new page's text and runs Write in my handwriting on it, once the page has been drawn. */
async function writeInHandwriting(): Promise<void> {
  for (let tries = 0; tries < 20; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const editor = targetEditor();
    if (editor) {
      editor.commands.selectAll();
      if (await executeCommand('ink.myHandwriting.write', undefined, 'menu').catch(() => false)) return;
      break;
    }
  }
  showToast({ message: t('docStructure.sheet.handwritingTip') });
}

export function FormulaSheetTool() {
  const chosen = selectedPages().length;
  const [source, setSource] = useState<Source>(chosen >= 2 ? 'selected' : 'current');
  const [columns, setColumns] = useState('0');
  const [hand, setHand] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const handAvailable = isEnabled('ink.myHandwriting');

  const say = (text: string) => {
    setMessage(text);
    announce(text);
  };

  const build = async () => {
    setBusy(true);
    say(t('docStructure.sheet.building'));
    try {
      const pages = await gather(source);
      if (pages.length === 0) return say(t('docStructure.sheet.noPages'));
      const formulas = collectFormulas(pages);
      if (formulas.length === 0) return say(t('docStructure.sheet.noEquations'));
      const sheet = buildSheet(formulas, Number(columns) || undefined);
      const title = t('docStructure.sheet.pageTitle');
      await (
        await loadTemplates()
      ).newPageWith({ kind: 'content', title, blocks: [tableBlock(sheet.rows, sheet.columns)] });
      const done = t('docStructure.sheet.built', { count: sheet.count });
      const left = sheet.overflow > 0 ? ` ${t('docStructure.sheet.overflow', { count: sheet.overflow })}` : '';
      say(done + left);
      showToast({ message: done + left });
      if (hand && handAvailable) void writeInHandwriting();
    } catch {
      say(t('docStructure.sheet.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={docs.tool}>
      <RadioGroup<Source> label={t('docStructure.sheet.from')} value={source} onChange={setSource}>
        <RadioCard<Source> value="current" label={t('docStructure.sheet.current')} />
        {chosen >= 2 ? (
          <RadioCard<Source> value="selected" label={t('docStructure.sheet.selected', { count: chosen })} />
        ) : null}
        <RadioCard<Source> value="section" label={t('docStructure.sheet.section')} />
      </RadioGroup>
      <label className={docs.field}>
        {t('docStructure.sheet.columns')}
        <select value={columns} onChange={(event) => setColumns(event.target.value)}>
          <option value="0">{t('docStructure.sheet.automatic')}</option>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={String(n)}>
              {t('docStructure.sheet.columnCount', { count: n })}
            </option>
          ))}
        </select>
      </label>
      {handAvailable ? (
        <div>
          <Switch label={t('docStructure.sheet.handwriting')} checked={hand} onChange={setHand} />
          <p className={docs.note}>{t('docStructure.sheet.handwritingHint')}</p>
        </div>
      ) : null}
      <div className={docs.buttons}>
        <Button variant="primary" onClick={() => void build()} disabled={busy}>
          {t('docStructure.sheet.build')}
        </Button>
      </div>
      <p className={docs.status} role="status">
        {message}
      </p>
    </div>
  );
}
