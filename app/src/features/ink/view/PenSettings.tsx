// The Pen and touch section of Settings (design 9.4): the writing hand the palm filter assumes, when a finger draws,
// the gestures, what each pen's buttons do, each pen's pressure curve and steady pen, the hover circle, and the zoom
// writing box. While a pen is near the screen a touch never draws, whatever the choice.
import { useFlag } from '../../../app/flags';
import type { BarrelAction } from '../../../platform/bindings/BarrelAction';
import type { EraserEndAction } from '../../../platform/bindings/EraserEndAction';
import type { FingerDraw } from '../../../platform/bindings/FingerDraw';
import type { Handedness } from '../../../platform/bindings/Handedness';
import type { PenCurve } from '../../../platform/bindings/PenCurve';
import { updateSettings, useSettings } from '../../../state/settings';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { RadioCard, RadioGroup, Switch } from '../../../ui';
import { CurvePreview } from './CurvePreview';
import { inkPrefs, penDevice, setPrefs, updatePen } from './prefs';

const BARRELS: readonly [BarrelAction, MessageKey][] = [
  ['lasso', 'ink.settings.barrelLasso'],
  ['strokeEraser', 'ink.settings.barrelStrokeEraser'],
  ['partialEraser', 'ink.settings.barrelPartialEraser'],
  ['lastHighlighter', 'ink.settings.barrelHighlighter'],
  ['pan', 'ink.settings.barrelPan'],
  ['rightClick', 'ink.settings.barrelRightClick'],
  ['nothing', 'ink.settings.barrelNothing'],
];

const ERASER_ENDS: readonly [EraserEndAction, MessageKey][] = [
  ['strokeEraser', 'ink.settings.eraserEndStroke'],
  ['partialEraser', 'ink.settings.eraserEndPartial'],
  ['highlighterEraser', 'ink.settings.eraserEndHighlighter'],
  ['nothing', 'ink.settings.eraserEndNothing'],
];

const CURVES: readonly [PenCurve, MessageKey][] = [
  ['soft', 'ink.settings.curveSoft'],
  ['normal', 'ink.settings.curveNormal'],
  ['firm', 'ink.settings.curveFirm'],
  ['custom', 'ink.settings.curveCustom'],
];

const MIN_WIDTHS = [0, 0.1, 0.2, 0.3, 0.4, 0.6] as const;
const STEADY: readonly [string, MessageKey][] = [
  ['3', 'ink.settings.steadyLight'],
  ['5', 'ink.settings.steadyMedium'],
  ['8', 'ink.settings.steadyStrong'],
];

function Gestures() {
  const gestures = useSettings((settings) => settings.ink.gestures);
  const rows: readonly [keyof typeof gestures, MessageKey][] = [
    ['scribbleErase', 'ink.gestures.scribbleErase'],
    ['circleSelect', 'ink.gestures.circleSelect'],
    ['twoFingerUndo', 'ink.gestures.twoFingerUndo'],
    ['threeFingerRedo', 'ink.gestures.threeFingerRedo'],
  ];
  return (
    <div role="group" aria-label={t('ink.gestures.group')}>
      <h3>{t('ink.gestures.group')}</h3>
      {rows.map(([key, label]) => (
        <Switch
          key={key}
          label={t(label)}
          checked={gestures[key]}
          onChange={(checked) => void updateSettings({ ink: { gestures: { [key]: checked } } })}
        />
      ))}
    </div>
  );
}

function PenChoices() {
  const buttons = useFlag('ink.penButtons');
  const feel = useFlag('ink.steadyPen');
  const prefs = useStore(inkPrefs, (state) => state);
  const key = prefs.lastPen;
  const pen = penDevice(key, prefs);
  const set = (change: Parameters<typeof updatePen>[1]) => updatePen(key, change);
  const custom = pen.customCurve ?? [0.33, 0.33, 0.67, 0.67];
  return (
    <>
      {prefs.seenPens.length > 1 && (
        <RadioGroup<string> label={t('ink.settings.pen')} value={key} onChange={(next) => setPrefs({ lastPen: next })}>
          {prefs.seenPens.map((id, index) => (
            <RadioCard<string>
              key={id}
              value={id}
              label={id === 'default' ? t('ink.settings.penDefault') : t('ink.settings.penNumber', { number: index })}
            />
          ))}
        </RadioGroup>
      )}
      {buttons && (
        <div role="group" aria-label={t('ink.settings.penButtons')}>
          <h3>{t('ink.settings.penButtons')}</h3>
          <RadioGroup<BarrelAction>
            label={t('ink.settings.barrel')}
            value={pen.barrel}
            onChange={(barrel) => set({ barrel })}
          >
            {BARRELS.map(([id, label]) => (
              <RadioCard<BarrelAction> key={id} value={id} label={t(label)} />
            ))}
          </RadioGroup>
          <RadioGroup<EraserEndAction>
            label={t('ink.settings.eraserEnd')}
            value={pen.eraserEnd}
            onChange={(eraserEnd) => set({ eraserEnd })}
          >
            {ERASER_ENDS.map(([id, label]) => (
              <RadioCard<EraserEndAction> key={id} value={id} label={t(label)} />
            ))}
          </RadioGroup>
          <p>{t('ink.settings.penButtonsHint')}</p>
        </div>
      )}
      {feel && (
        <div role="group" aria-label={t('ink.settings.pressure')}>
          <h3>{t('ink.settings.pressure')}</h3>
          <RadioGroup<PenCurve>
            label={t('ink.settings.pressure')}
            value={pen.curve}
            onChange={(curve) => set({ curve })}
          >
            {CURVES.map(([id, label]) => (
              <RadioCard<PenCurve> key={id} value={id} label={t(label)} />
            ))}
          </RadioGroup>
          {pen.curve === 'custom' && (
            <>
              <label>
                {t('ink.settings.curveLight')}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={custom[1]}
                  onChange={(event) => set({ customCurve: [0.33, Number(event.target.value), 0.67, custom[3]] })}
                />
              </label>
              <label>
                {t('ink.settings.curveHeavy')}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={custom[3]}
                  onChange={(event) => set({ customCurve: [0.33, custom[1], 0.67, Number(event.target.value)] })}
                />
              </label>
            </>
          )}
          <RadioGroup<string>
            label={t('ink.settings.minWidth')}
            value={String(pen.minWidth)}
            onChange={(value) => set({ minWidth: Number(value) })}
          >
            {MIN_WIDTHS.map((value) => (
              <RadioCard<string>
                key={value}
                value={String(value)}
                label={t('ink.settings.minWidthValue', { percent: Math.round(value * 100) })}
              />
            ))}
          </RadioGroup>
          <p>{t('ink.settings.pressureHint')}</p>
          <CurvePreview pen={pen} label={t('ink.settings.preview')} />
          <Switch
            label={t('ink.settings.steady')}
            checked={pen.steady > 0}
            onChange={(on) => set({ steady: on ? 5 : 0 })}
          />
          <p>{t('ink.settings.steadyHint')}</p>
          {pen.steady > 0 && (
            <RadioGroup<string>
              label={t('ink.settings.steadyStrength')}
              value={String(pen.steady)}
              onChange={(value) => set({ steady: Number(value) })}
            >
              {STEADY.map(([value, label]) => (
                <RadioCard<string> key={value} value={value} label={t(label)} />
              ))}
            </RadioGroup>
          )}
        </div>
      )}
    </>
  );
}

function ZoomBoxSettings() {
  const box = useSettings((settings) => settings.ink.zoomBox);
  return (
    <div role="group" aria-label={t('ink.settings.zoomBox')}>
      <h3>{t('ink.settings.zoomBox')}</h3>
      <RadioGroup<string>
        label={t('ink.settings.magnification')}
        value={String(box.magnification)}
        onChange={(value) => void updateSettings({ ink: { zoomBox: { magnification: Number(value) } } })}
      >
        {[2, 3, 4].map((times) => (
          <RadioCard<string>
            key={times}
            value={String(times)}
            label={t('ink.settings.magnificationValue', { times })}
          />
        ))}
      </RadioGroup>
      <Switch
        label={t('ink.settings.autoAdvance')}
        checked={box.autoAdvance}
        onChange={(autoAdvance) => void updateSettings({ ink: { zoomBox: { autoAdvance } } })}
      />
    </div>
  );
}

export default function PenSettings() {
  const ink = useSettings((settings) => settings.ink);
  const gestures = useFlag('ink.gestures');
  const hover = useFlag('ink.hover');
  const zoomBox = useFlag('ink.zoomBox');
  const anchoring = useFlag('ink.anchoring');
  const hovering = useStore(inkPrefs, (state) => state.hover);
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
      {gestures && <Gestures />}
      {anchoring && (
        <Switch
          label={t('ink.anchor.auto')}
          checked={ink.anchorToText}
          onChange={(anchorToText) => void updateSettings({ ink: { anchorToText } })}
        />
      )}
      {hover && (
        <Switch label={t('ink.settings.hover')} checked={hovering} onChange={(on) => setPrefs({ hover: on })} />
      )}
      <PenChoices />
      {zoomBox && <ZoomBoxSettings />}
    </section>
  );
}
