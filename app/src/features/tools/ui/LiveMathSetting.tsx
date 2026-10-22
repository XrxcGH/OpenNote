// The live math switches in Settings, then Editing: answers on page lines, and solutions offered while writing.
import { useState } from 'react';
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { Switch } from '../../../ui';
import { lineAnswersOn, liveSolveOn, setLineAnswersOn, setLiveSolveOn } from '../editor/liveMath';

export default function LiveMathSetting() {
  const [answers, setAnswers] = useState(lineAnswersOn);
  const [solve, setSolve] = useState(liveSolveOn);
  return (
    <div>
      <Switch
        label={t('mathTools.live.answersLabel')}
        checked={answers}
        onChange={(next) => {
          setLineAnswersOn(next);
          setAnswers(next);
        }}
      />
      <p>{t('mathTools.live.answersHelp')}</p>
      {isEnabled('math.liveSolve') ? (
        <>
          <Switch
            label={t('mathTools.live.solveLabel')}
            checked={solve}
            onChange={(next) => {
              setLiveSolveOn(next);
              setSolve(next);
            }}
          />
          <p>{t('mathTools.live.solveHelp')}</p>
        </>
      ) : null}
    </div>
  );
}
