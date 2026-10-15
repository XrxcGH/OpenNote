// Settings > Pen and touch > Palm lab (flag dev.penRecorder): guided steps, a device probe, a labeled recording of
// what a pen and a hand do on a pad, and an export to tests/fixtures/palm/. Recording stays in memory until saved.
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { commandContext } from '../../../commands/registry';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, RadioCard, RadioGroup, Switch, announce, showToast } from '../../../ui';
import { TASKS } from '../input/testing/capture';
import { PROFILES } from '../input/testing/profiles';
import type { Grip } from '../input/testing/session';
import { DEFAULT_SETUP, LAB_TASKS, labFileName, labFileText, labHeader, startRecording } from './labRecorder';
import type { LabRecording, LabResult, LabSetup } from './labRecorder';

const GRIPS: readonly Grip[] = ['tripod', 'hooked', 'overwriter', 'fist'];
const GRIP_LABEL: Record<Grip, MessageKey> = {
  tripod: 'ink.palmLab.gripTripod',
  hooked: 'ink.palmLab.gripHooked',
  overwriter: 'ink.palmLab.gripOverwriter',
  fist: 'ink.palmLab.gripFist',
};

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export default function PalmLab() {
  const [setup, setSetup] = useState<LabSetup>(DEFAULT_SETUP);
  const [recording, setRecording] = useState(false);
  const [events, setEvents] = useState(0);
  const [result, setResult] = useState<LabResult | null>(null);
  const live = useRef<LabRecording | null>(null);
  const set = (change: Partial<LabSetup>) => setSetup((s) => ({ ...s, ...change }));

  const start = () => {
    const env = { dpr: window.devicePixelRatio, w: window.innerWidth, h: window.innerHeight, ua: navigator.userAgent };
    live.current = startRecording(labHeader(setup, env));
    setEvents(0);
    setResult(null);
    setRecording(true);
    announce(t('ink.palmLab.started'));
  };
  const stop = () => {
    if (!live.current) return;
    setResult(live.current.stop());
    live.current = null;
    setRecording(false);
    announce(t('ink.palmLab.stopped'));
  };
  const feed = (e: ReactPointerEvent) => {
    if (live.current) setEvents(live.current.feed(e.nativeEvent));
  };
  const save = async () => {
    if (!result || result.problems.length > 0) return;
    const { exports } = commandContext('commandBar').platform;
    const path = await exports.pickSave({
      suggested: labFileName(result.session),
      label: t('ink.palmLab.fileLabel'),
      extension: 'jsonl',
    });
    if (path) await exports.write(path, [{ path: '', bytes: new TextEncoder().encode(labFileText(result)) }]);
    if (path) showToast({ message: t('ink.palmLab.saved') });
  };

  return (
    <div role="group" aria-label={t('ink.palmLab.title')}>
      <h3>{t('ink.palmLab.title')}</h3>
      <p>{t('ink.palmLab.intro')}</p>
      <label>
        {t('ink.palmLab.device')}
        <input value={setup.model} onChange={(e) => set({ model: e.target.value })} />
      </label>
      <label>
        {t('ink.palmLab.profile')}
        <select value={setup.profile} onChange={(e) => set({ profile: e.target.value })}>
          {PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <RadioGroup<string> label={t('ink.palmLab.step')} value={setup.task} onChange={(task) => set({ task })}>
        {LAB_TASKS.map((id) => (
          <RadioCard<string> key={id} value={id} label={TASKS[id].prompt} />
        ))}
      </RadioGroup>
      <RadioGroup<string>
        label={t('ink.palmLab.hand')}
        value={setup.handedness}
        onChange={(h) => set({ handedness: h === 'left' ? 'left' : 'right' })}
      >
        <RadioCard<string> value="right" label={t('ink.settings.handednessRight')} />
        <RadioCard<string> value="left" label={t('ink.settings.handednessLeft')} />
      </RadioGroup>
      <RadioGroup<string>
        label={t('ink.palmLab.grip')}
        value={setup.grip}
        onChange={(g) => set({ grip: GRIPS.find((x) => x === g) ?? 'tripod' })}
      >
        {GRIPS.map((g) => (
          <RadioCard<string> key={g} value={g} label={t(GRIP_LABEL[g])} />
        ))}
      </RadioGroup>
      <Switch label={t('ink.palmLab.consent')} checked={setup.consent} onChange={(consent) => set({ consent })} />
      <div
        role="application"
        aria-label={t('ink.palmLab.pad')}
        data-palm-lab-pad=""
        style={{ minHeight: 200, border: '1px dashed currentColor', touchAction: 'none' }}
        onPointerDown={feed}
        onPointerMove={feed}
        onPointerUp={feed}
        onPointerCancel={feed}
      >
        <p>{recording ? t('ink.palmLab.recording', { count: events }) : t('ink.palmLab.idle')}</p>
      </div>
      {recording ? (
        <Button onClick={stop}>{t('ink.palmLab.stop')}</Button>
      ) : (
        <Button onClick={start} disabled={!setup.consent}>
          {t('ink.palmLab.start')}
        </Button>
      )}
      {result && (
        <div role="status" data-palm-lab-result="">
          <p>
            {t('ink.palmLab.probe', {
              hover: result.capabilities.hover,
              tilt: result.capabilities.tiltMode,
              size: result.capabilities.sizeMode,
              rate: result.capabilities.rateHz,
            })}
          </p>
          <p>{t('ink.palmLab.contacts', { pen: result.contacts.pen, touch: result.contacts.touch })}</p>
          {result.problems.length > 0 && <p>{result.problems.join('; ')}</p>}
          <Button onClick={() => void save()} disabled={result.problems.length > 0}>
            {t('ink.palmLab.export')}
          </Button>
          <p>{t('ink.palmLab.exportHint')}</p>
        </div>
      )}
    </div>
  );
}
