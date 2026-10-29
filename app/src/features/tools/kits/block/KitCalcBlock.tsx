// The live calculation block on a page: the tool's title, the summary, the key results, and the equation, with an
// Open in tool button that reopens the kit tool with the inputs the block saved. It never changes the page itself,
// so it works on a read-only page too.
import 'katex/dist/katex.min.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../../ui';
import { openKitTool } from '../registry';
import { MathLine } from '../ui/output';
import { say } from '../ui/words';
import styles from '../ui/kit.module.css';
import type { KitCalcData } from './model';
import { readKitCalc } from './model';

interface BlockProps {
  data: Record<string, unknown>;
  announce(text: string): void;
}

export function KitCalcView({ data, announce }: { data: KitCalcData; announce(text: string): void }) {
  const [missing, setMissing] = useState(false);
  const open = async () => {
    const opened = await openKitTool(data.kit, data.tool, data.inputs ?? undefined);
    setMissing(!opened);
    announce(say(opened ? 'kits.block.opened' : 'kits.block.missing'));
  };
  return (
    <section className={styles.block} aria-label={say('kits.block.label')}>
      <p className={styles.blockTitle}>{data.title || say('kits.block.label')}</p>
      {data.summary && <p className={styles.note}>{data.summary}</p>}
      {data.rows && data.rows.length > 0 && (
        <dl className={styles.blockRows} aria-label={say('kits.block.results')}>
          {data.rows.map((row, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <dt>{row.label}</dt>
              <dd>{row.unit ? `${row.value} ${row.unit}` : row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.latex && <MathLine latex={data.latex} display />}
      <div className={styles.buttons}>
        <Button onClick={() => void open()}>{say('kits.block.open')}</Button>
      </div>
      {missing && <p className={styles.problem}>{say('kits.block.missing')}</p>}
    </section>
  );
}

/** Mounts the block for the page's panel host. */
export function mountKitCalc(container: HTMLElement, props: BlockProps) {
  const root = createRoot(container);
  const render = (next: BlockProps) => {
    const data = readKitCalc(next.data);
    root.render(
      data ? (
        <KitCalcView data={data} announce={next.announce} />
      ) : (
        <p className={styles.problem}>{say('kits.block.missing')}</p>
      ),
    );
  };
  render(props);
  return { update: render, destroy: () => setTimeout(() => root.unmount(), 0) };
}
