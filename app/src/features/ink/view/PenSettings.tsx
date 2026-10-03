// Settings, Pen and touch (design 9.4): the writing hand the palm filter assumes, and when a finger draws. While a
// pen is near the screen a touch never draws, whatever the choice.
import type { FingerDraw } from '../../../platform/bindings/FingerDraw';
import type { Handedness } from '../../../platform/bindings/Handedness';
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { RadioCard, RadioGroup } from '../../../ui';

export default function PenSettings() {
  const ink = useSettings((settings) => settings.ink);
  return (
    <section aria-labelledby="ink-settings">
      <h2 id="ink-settings">{t('ink.settings.title')}</h2>
      <RadioGroup<Handedness>
        label={t('ink.settings.handedness')}
        value={ink.handedness}
        onChange={(handedness) => void updateSettings({ ink: { handedness } })}
      >
        <RadioCard<Handedness> value="auto" label={t('ink.settings.handednessAuto')} />
        <RadioCard<Handedness> value="right" label={t('ink.settings.handednessRight')} />
        <RadioCard<Handedness> value="left" label={t('ink.settings.handednessLeft')} />
      </RadioGroup>
      <RadioGroup<FingerDraw>
        label={t('ink.settings.fingerDraw')}
        value={ink.touch.finger}
        onChange={(finger) => void updateSettings({ ink: { touch: { finger, draws: finger === 'on' } } })}
      >
        <RadioCard<FingerDraw> value="auto" label={t('ink.settings.fingerDrawAuto')} />
        <RadioCard<FingerDraw> value="on" label={t('ink.settings.fingerDrawOn')} />
        <RadioCard<FingerDraw> value="off" label={t('ink.settings.fingerDrawOff')} />
      </RadioGroup>
      <p>{t('ink.settings.fingerDrawHint')}</p>
    </section>
  );
}
