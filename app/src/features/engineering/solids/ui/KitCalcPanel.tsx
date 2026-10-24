// A live calculation in a page: the tool's answer as it was inserted, the values typed, and a button that opens the
// tool on those values, so a student can change one and work the problem again.
import { Button } from '../../../../ui';
import type { BlockProps } from '../../canvas/shared';
import { SOLIDS_TOOLS } from '../meta';
import { readCalc, reopenCalc } from '../open';
import { say } from './ToolPanel';
import styles from './solids.module.css';

export function KitCalcPanel({ data }: BlockProps) {
  const calc = readCalc(data);
  if (!calc) return <p className={styles.problem}>{say('kitSolids.calc.unreadable')}</p>;
  const tool = SOLIDS_TOOLS.find((one) => one.id === calc.tool);
  const typed = Object.entries(calc.texts).filter(([, text]) => text.trim() !== '');
  return (
    <section className={styles.calc} aria-label={say('kitSolids.calc.block')}>
      <p className={styles.calcTitle}>{tool ? say(tool.title) : calc.tool}</p>
      <p>{calc.summary}</p>
      <details>
        <summary>{say('kitSolids.calc.inputs', { count: typed.length })}</summary>
        <ul className={styles.calcInputs}>
          {typed.map(([id, text]) => (
            <li key={id}>
              {say(`kitSolids.${calc.tool}.field.${id}`)}: <code>{text}</code>
            </li>
          ))}
        </ul>
      </details>
      {tool && <Button onClick={() => void reopenCalc(calc)}>{say('kitSolids.calc.open')}</Button>}
    </section>
  );
}
