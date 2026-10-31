// The tutor's switch in Settings, then Editing (ADR 0050). Off until the person turns it on. With the switch on and
// cloud keys built in, the person can also choose where the tutor writes: on this device, or with their own key.
import { lazy, Suspense, useState } from 'react';
import { isEnabled } from '../../app/flags';
import { t } from '../../strings/t';
import { Switch } from '../../ui';
import { chooseTutor, tutorChosen } from './choice';

const CloudChoice = lazy(() =>
  import('../intel').then((intel) => intel.loadApi()).then((api) => ({ default: api.CloudChoice })),
);

export default function TutorSetting() {
  const [on, setOn] = useState(tutorChosen);
  return (
    <div>
      <Switch
        label={t('tutor.setting.label')}
        checked={on}
        onChange={(next) => {
          chooseTutor(next);
          setOn(next);
        }}
      />
      <p>{t('tutor.setting.help')}</p>
      {on && (
        <>
          <p>{t('tutor.setting.engineHelp')}</p>
          {isEnabled('intel.cloudKeys') && (
            <Suspense fallback={null}>
              <CloudChoice feature="tutor" name={t('tutor.setting.engineName')} />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
