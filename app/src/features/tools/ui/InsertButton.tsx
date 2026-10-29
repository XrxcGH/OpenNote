// An Insert button that writes text at the caret of the page that is open, and says in words what happened.
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { insertIntoPage } from './CalculatorTool';
import ref from './reference.module.css';

export function InsertButton({
  text,
  label,
  caption,
  flush,
}: {
  text: string;
  label: string;
  caption?: string;
  /** Aligns the label with the content edge rather than the button's own padding (a button on its own line). */
  flush?: boolean;
}) {
  return (
    <Button
      variant="quiet"
      className={flush ? ref.flush : undefined}
      aria-label={label}
      onClick={() => announce(t(insertIntoPage({ text }) ? 'study.reference.inserted' : 'study.reference.noPage'))}
    >
      {caption ?? t('study.reference.insert')}
    </Button>
  );
}
