// A tool in a window of its own (Phase 10): the window the app opens when a tool is popped out. The address names
// the tool (?tool=timers), and the whole window is that tool.
import { t } from '../../../strings/t';
import { ToolBody } from './host';
import styles from './tools.module.css';
import { TOOLS, isToolId } from './tools';

export function PoppedTool({ tool }: { tool: string }) {
  if (!isToolId(tool)) return null;
  const def = TOOLS.find((one) => one.id === tool)!;
  return (
    <main className={styles.popped} aria-label={t(def.title)}>
      <ToolBody tool={tool} />
    </main>
  );
}
