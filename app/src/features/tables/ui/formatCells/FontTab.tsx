import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { FontPicker, useFontCatalog } from '../../../fonts';
import { ColorField, NumberInput, Select } from './controls';
import type { TabProps } from './controls';
import { withFace, withProp } from './draft';
import styles from './formatCells.module.css';

const noFonts = { list: () => Promise.resolve([]) };
const UNDERLINES = ['none', 'single', 'double', 'singleAccounting', 'doubleAccounting'] as const;
const UNDERLINE_KEYS: Record<(typeof UNDERLINES)[number], MessageKey> = {
  none: 'sheetFormat.font.underlineNone',
  single: 'sheetFormat.font.underlineSingle',
  double: 'sheetFormat.font.underlineDouble',
  singleAccounting: 'sheetFormat.font.underlineSingleAccounting',
  doubleAccounting: 'sheetFormat.font.underlineDoubleAccounting',
};

export function FontTab({ style, set, scheme, notebookId }: TabProps) {
  const catalog = useFontCatalog(noFonts);
  const font = style.font ?? {};
  const face = font.bold ? (font.italic ? 'boldItalic' : 'bold') : font.italic ? 'italic' : 'regular';
  const faces = ['regular', 'bold', 'italic', 'boldItalic'] as const;
  const faceKeys: Record<(typeof faces)[number], MessageKey> = {
    regular: 'sheetFormat.font.regular',
    bold: 'sheetFormat.font.bold',
    italic: 'sheetFormat.font.italic',
    boldItalic: 'sheetFormat.font.boldItalic',
  };
  const setFace = (value: (typeof faces)[number]) => {
    const bold = value === 'bold' || value === 'boldItalic';
    const italic = value === 'italic' || value === 'boldItalic';
    set(withFace(style, bold, italic));
  };
  const underline = (font.underline ?? 'none') as (typeof UNDERLINES)[number];
  const strike = font.strike ?? 'none';
  const script = font.script ?? 'none';
  const strikes = ['none', 'single', 'double'] as const;
  const scripts = ['none', 'super', 'sub'] as const;
  return (
    <div className={styles.grid}>
      <div className={styles.field}>
        <span>{t('sheetFormat.font.family')}</span>
        <FontPicker
          catalog={catalog}
          value={font.family ?? null}
          onPick={(name) => set(withProp(style, 'font', 'family', name))}
        />
      </div>
      <Select
        label={t('sheetFormat.font.style')}
        value={face}
        values={faces}
        name={(v) => t(faceKeys[v])}
        onChange={setFace}
      />
      <NumberInput
        label={t('sheetFormat.font.size')}
        value={font.size}
        min={1}
        max={1638}
        step={0.5}
        onChange={(n) => set(withProp(style, 'font', 'size', n))}
      />
      <Select
        label={t('sheetFormat.font.underline')}
        value={underline}
        values={UNDERLINES}
        name={(v) => t(UNDERLINE_KEYS[v])}
        onChange={(v) => set(withProp(style, 'font', 'underline', v === 'none' ? undefined : v))}
      />
      <Select
        label={t('sheetFormat.font.strike')}
        value={strike}
        values={strikes}
        name={(v) => t(`sheetFormat.font.strike${v[0].toUpperCase()}${v.slice(1)}` as MessageKey)}
        onChange={(v) => set(withProp(style, 'font', 'strike', v === 'none' ? undefined : v))}
      />
      <Select
        label={t('sheetFormat.font.script')}
        value={script}
        values={scripts}
        name={(v) => t(`sheetFormat.font.script${v[0].toUpperCase()}${v.slice(1)}` as MessageKey)}
        onChange={(v) => set(withProp(style, 'font', 'script', v === 'none' ? undefined : v))}
      />
      <ColorField
        label={t('sheetFormat.font.color')}
        value={font.color}
        scheme={scheme}
        notebookId={notebookId}
        onPick={(value) => set(withProp(style, 'font', 'color', value))}
      />
    </div>
  );
}
