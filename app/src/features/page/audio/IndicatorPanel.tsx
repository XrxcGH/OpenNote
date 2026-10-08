// What the indicator opens (Phase 9): the levels, the warnings, and pause, stop, and flag.
import { useFlag } from '../../../app/flags';
import { executeCommand } from '../../../commands/registry';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import styles from './audio.module.css';
import { followSystemOutput, warningText } from './controller';
import { clock } from './format';
import { Meter } from './Meter';
import { recordingUi } from './state';

export default function IndicatorPanel({ onClose }: { onClose(): void }) {
  const ui = useStore(recordingUi, (state) => state);
  const flags = useFlag('audio.flags');
  const paused = ui.phase === 'paused';
  const run = (id: 'audio.pause' | 'audio.flag' | 'audio.stop') => () => void executeCommand(id, undefined, 'titleBar');
  return (
    <div className={styles.panel}>
      <h2>{clock(ui.elapsedMs)}</h2>
      {ui.source && <p className={styles.hint}>{ui.source}</p>}
      <Meter state={ui.meters.microphone} label={t('audio.indicator.meter')} />
      {ui.meters.systemAudio && <Meter state={ui.meters.systemAudio} label={t('audio.indicator.systemMeter')} />}
      {ui.warnings.map((warning, index) => (
        <p key={index} className={styles.warning} role="status">
          {warningText(warning)}
          {warning.type === 'notDefaultDevice' && (
            <>
              {' '}
              <Button variant="quiet" onClick={() => void followSystemOutput()}>
                {t('audio.warnings.followOutput')}
              </Button>
            </>
          )}
        </p>
      ))}
      <div className={styles.row}>
        <Button variant="secondary" onClick={run('audio.pause')}>
          {t(paused ? 'audio.bar.resume' : 'audio.bar.pause')}
        </Button>
        {flags && (
          <Button variant="secondary" onClick={run('audio.flag')}>
            {t('audio.bar.flag')}
          </Button>
        )}
        <Button
          variant="primary"
          onClick={() => {
            onClose();
            void executeCommand('audio.stop', undefined, 'titleBar');
          }}
        >
          {t('audio.bar.stop')}
        </Button>
      </div>
    </div>
  );
}
