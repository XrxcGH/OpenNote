// The kits' Insert into page button: a menu of what this result can become on the page (an answer line, an equation,
// the results table, the worked steps, a picture, or a live calculation block), listing only what the tool has.
import { Button, announce, openMenu } from '../../../../ui';
import type { MenuItemSpec } from '../../../../ui';
import type { KitInsertContent } from '../types';
import { insertAnswer, insertEquation, insertLiveBlock, insertPicture, insertSteps, insertTable } from './insert';
import { say } from './words';

export interface InsertMenuProps {
  content: KitInsertContent;
  /** Present when the result can become a live calculation block that reopens the tool. */
  live?: { kit: string; tool: string; title: string; inputs: unknown };
  disabled?: boolean;
}

type Action = { id: string; label: string; run(): boolean };

/** The menu's choices for a result, in a fixed order. Exported for tests. */
export function insertActions({ content, live }: InsertMenuProps): Action[] {
  const actions: Action[] = [];
  const { answer, latex, rows, steps, picture, summary } = content;
  if (answer) actions.push({ id: 'answer', label: say('kits.insert.answer'), run: () => insertAnswer(answer) });
  if (latex) actions.push({ id: 'equation', label: say('kits.insert.equation'), run: () => insertEquation(latex) });
  if (rows?.length) actions.push({ id: 'table', label: say('kits.insert.table'), run: () => insertTable(rows) });
  if (steps?.length) actions.push({ id: 'steps', label: say('kits.insert.steps'), run: () => insertSteps(steps) });
  if (picture) {
    actions.push({
      id: 'picture',
      label: say('kits.insert.picture'),
      run: () => insertPicture(picture.svg, picture.alt),
    });
  }
  if (live) {
    actions.push({
      id: 'live',
      label: say('kits.insert.live'),
      run: () =>
        insertLiveBlock({
          ...live,
          summary: summary ?? answer ?? live.title,
          rows: (rows ?? []).map((row) => ({ label: row.label, value: row.value, unit: row.unit })),
          ...(latex ? { latex } : {}),
        }),
    });
  }
  return actions;
}

export function InsertMenu(props: InsertMenuProps) {
  const actions = insertActions(props);
  const open = async (button: HTMLButtonElement) => {
    const items: MenuItemSpec[] = actions.map((action) => ({ id: action.id, label: action.label }));
    const chosen = await openMenu({ label: say('kits.insert.menu'), items, anchor: button, returnFocus: button });
    const action = actions.find((one) => one.id === chosen);
    if (!action) return;
    const done = action.run();
    announce(say(done ? (action.id === 'live' ? 'kits.block.inserted' : 'kits.insert.done') : 'kits.insert.noPage'));
  };
  return (
    <Button
      variant="primary"
      disabled={props.disabled || actions.length === 0}
      aria-haspopup="menu"
      onClick={(event) => void open(event.currentTarget)}
    >
      {say('kits.insert.button')}
    </Button>
  );
}
