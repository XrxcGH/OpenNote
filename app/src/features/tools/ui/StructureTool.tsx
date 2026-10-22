// The chemical structure window: type a SMILES line or pick a starting structure, see the skeletal formula, and put it
// on the page as editable ink (every bond its own shape, every atom label a text box), save it as an SVG, or insert its
// formula. Nothing leaves the device.
import { useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, announce, showToast } from '../../../ui';
import { hillFormula, molarMass } from '../chem/calc/formula';
import { sig } from '../chem/calc/stoich';
import { drawSmiles, toSvg } from '../chem/structure/render';
import type { Drawing } from '../chem/structure/render';
import { TEMPLATES } from '../chem/structure/templates';
import { insertIntoPage } from './CalculatorTool';
import styles from './chem.module.css';
import extra from './extra.module.css';
import { loadStored, saveStored } from './storage';
import tools from './tools.module.css';

const STORE = 'structure';
/** One bond is this long on the page, in page units. */
const BOND = 44;
const GROUPS = ['rings', 'chains', 'groups', 'small'] as const;

function Preview({ drawing, label }: { drawing: Drawing; label: string }) {
  const { minX, minY, maxX, maxY } = drawing.bounds;
  const u = 40;
  const w = (maxX - minX) * u;
  const h = (maxY - minY) * u;
  const X = (v: number) => (v - minX) * u;
  const Y = (v: number) => (v - minY) * u;
  return (
    <figure className={styles.figure}>
      <svg viewBox={`0 0 ${w} ${h}`} width={Math.min(w, 320)} role="img" aria-label={label}>
        <g stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          {drawing.segments.map((s, i) => (
            <line key={i} x1={X(s.from.x)} y1={Y(s.from.y)} x2={X(s.to.x)} y2={Y(s.to.y)} />
          ))}
        </g>
        <g fill="currentColor" fontSize={u * 0.42} textAnchor="middle" dominantBaseline="central">
          {drawing.labels.map((l) => (
            <text key={l.atom} x={X(l.at.x)} y={Y(l.at.y)}>
              {l.text}
            </text>
          ))}
        </g>
      </svg>
    </figure>
  );
}

export function StructureTool() {
  const [smiles, setSmiles] = useState(
    () => loadStored<{ smiles?: string }>(STORE, {}).smiles ?? 'CC(=O)Oc1ccccc1C(=O)O',
  );
  const [name, setName] = useState('');
  const result = useMemo(() => (smiles.trim() === '' ? null : drawSmiles(smiles)), [smiles]);
  const set = (next: string, templateName = '') => {
    setSmiles(next);
    setName(templateName);
    saveStored(STORE, { smiles: next });
  };

  const info = result?.ok ? hillFormula(result.drawing.formula) : null;
  const mass = info ? molarMass(info) : null;
  const title = name || info || t('chem.structure.title');

  const toInk = async () => {
    if (!result?.ok) return;
    const { drawing } = result;
    const cx = (drawing.bounds.minX + drawing.bounds.maxX) / 2;
    const cy = (drawing.bounds.minY + drawing.bounds.maxY) / 2;
    const at = (p: { x: number; y: number }) => ({ x: (p.x - cx) * BOND, y: (p.y - cy) * BOND });
    const ink = await import('../../ink');
    await ink.insertDrawing({
      lines: drawing.segments.map((s) => [at(s.from), at(s.to)]),
      labels: drawing.labels.map((l) => ({ ...at(l.at), text: l.text })),
    });
  };

  const saveSvg = async () => {
    if (!result?.ok) return;
    const { saveBytes } = await import('../../study');
    const file = `${(name || info || 'structure').replace(/[^\p{L}\p{N}]+/gu, '-')}.svg`;
    const svg = toSvg(result.drawing, { title });
    try {
      if (await saveBytes(file, t('chem.structure.svgLabel'), new TextEncoder().encode(svg), 'image/svg+xml')) {
        showToast({ message: t('chem.structure.saved', { name: file }) });
      }
    } catch {
      showToast({ message: t('chem.structure.saveFailed'), tone: 'danger' });
    }
  };

  const insertFormula = () => {
    if (!info) return;
    const text = `${info} (${t('chem.structure.molarMass')} ${sig(mass ?? 0, 5)} g/mol)`;
    announce(t(insertIntoPage({ text }) ? 'chem.inserted' : 'chem.noPage'));
  };

  const problem = result && !result.ok ? t(`chem.structure.errors.${result.reason}` as MessageKey) : '';

  return (
    <div className={tools.tool}>
      <label className={extra.field}>
        {t('chem.structure.start')}
        <select
          className={extra.input}
          value=""
          onChange={(event) => {
            const picked = TEMPLATES.find((x) => x.id === event.target.value);
            if (picked) set(picked.smiles, t(`chem.structure.names.${picked.id}` as MessageKey));
          }}
        >
          <option value="">{t('chem.structure.pick')}</option>
          {GROUPS.map((group) => (
            <optgroup key={group} label={t(`chem.structure.groups.${group}`)}>
              {TEMPLATES.filter((x) => x.group === group).map((x) => (
                <option key={x.id} value={x.id}>
                  {t(`chem.structure.names.${x.id}` as MessageKey)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className={extra.field}>
        {t('chem.structure.smiles')}
        <input
          type="text"
          className={extra.input}
          value={smiles}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={problem ? true : undefined}
          aria-describedby="chem-smiles-help"
          onChange={(event) => set(event.target.value)}
        />
      </label>
      <p id="chem-smiles-help" className={tools.note}>
        {t('chem.structure.help')}
      </p>
      <div role="status" aria-live="polite">
        {problem ? <p className={tools.problem}>{problem}</p> : null}
        {result?.ok ? (
          <>
            <Preview drawing={result.drawing} label={t('chem.structure.pictureOf', { name: title })} />
            <p className={styles.headline}>
              {info}
              {mass ? ` · ${sig(mass, 5)} g/mol` : ''}
            </p>
          </>
        ) : null}
      </div>
      <div className={tools.buttons}>
        <Button variant="primary" disabled={!result?.ok} onClick={() => void toInk()}>
          {t('chem.structure.toInk')}
        </Button>
        <Button variant="quiet" disabled={!result?.ok} onClick={() => void saveSvg()}>
          {t('chem.structure.saveSvg')}
        </Button>
        <Button variant="quiet" disabled={!result?.ok} onClick={insertFormula}>
          {t('chem.structure.insertFormula')}
        </Button>
      </div>
      <p className={tools.note}>{t('chem.structure.note')}</p>
    </div>
  );
}
