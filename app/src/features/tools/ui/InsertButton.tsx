// An Insert button that writes text at the caret of the page that is open, and says in words what happened.
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { insertIntoPage } from './CalculatorTool';

export function InsertButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      variant="quiet"
      aria-label={label}
      onClick={() => announce(t(insertIntoPage({ text }) ? 'study.reference.inserted' : 'study.reference.noPage'))}
    >
      {t('study.reference.insert')}
    </Button>
  );
}
