// The calculation block on the page: the tool's name, the answer it gave, and a button that opens the kit on that
// tool with the block's inputs, to change them and insert again.
import { Button } from '../../../../ui';
import type { BlockProps } from '../../canvas/shared';
import { openMechDynKit } from '../open';
import { readCalc } from './calc';
import { say } from './ToolPanel';
import styles from './mechdyn.module.css';

export function CalcBlock({ data, announce }: BlockProps) {
  const calc = readCalc(data);
  if (!calc) return <p className={styles.problem}>{say('kitMechDyn.ui.calcBad')}</p>;
  const title = say(`kitMechDyn.${calc.tool}.title`);
  const open = () => {
    void openMechDynKit(calc.tool, { texts: calc.inputs, system: calc.system });
    announce(say('kitMechDyn.ui.calcOpened', { tool: title }));
  };
  return (
    <div className={styles.calc}>
      <p className={styles.calcSummary}>{calc.summary || title}</p>
      <Button onClick={open}>{say('kitMechDyn.ui.calcOpen')}</Button>
    </div>
  );
}
