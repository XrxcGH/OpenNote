// The offer after two crashes in a row (docs/design/SCREENS.md, Start in safe mode). It shows before the notebook
// opens. "Start in safe mode" and "Start normally" are buttons of the same size and weight, and neither is chosen
// for the person. Escape and closing mean "Start normally".

import { useEffect, useReducer, useRef } from 'react';
import { Dialog } from '../../ui';
import styles from './Diagnostics.module.css';
import { reduceSafeStart, safeStartText } from './safeStart';
import type { SafeStartFlow } from './safeStart';

export function SafeStartDialog({
  flow,
  onChoose,
}: {
  flow: SafeStartFlow;
  onChoose(result: 'safe' | 'normal'): void;
}) {
  const [state, dispatch] = useReducer(reduceSafeStart, flow);
  const body = useRef<HTMLDivElement>(null);
  const text = safeStartText(flow);
  useEffect(() => {
    if (state.closed && state.result) onChoose(state.result);
  }, [state, onChoose]);
  return (
    <Dialog
      title={text.title}
      size="medium"
      initialFocus={body}
      onDismiss={() => dispatch({ type: 'dismiss' })}
      actions={[
        {
          id: 'normal',
          label: text.startNormal,
          variant: 'secondary',
          onPress: () => dispatch({ type: 'startNormal' }),
        },
        { id: 'safe', label: text.startSafe, variant: 'secondary', onPress: () => dispatch({ type: 'startSafe' }) },
      ]}
    >
      <div ref={body} tabIndex={-1} className={styles.body}>
        {text.intro.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <h3>{text.offHeading}</h3>
        <ul>
          {text.off.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{text.kept}</p>
      </div>
    </Dialog>
  );
}
