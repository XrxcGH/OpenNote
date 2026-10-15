// Choosing what a new collection block shows: a collection saved on this device, or the pages of the open section.
import { showDialog } from '../../qol';
import { getLocation } from '../../../app/location';
import { t } from '../../../strings/t';
import { Button, Dialog } from '../../../ui';
import { emptyCollection } from '../engine';
import type { CollectionDef } from '../engine';
import { loadCollections } from '../store';

function Chooser(props: { options: readonly CollectionDef[]; done(choice: CollectionDef | null): void }) {
  const { options, done } = props;
  return (
    <Dialog
      title={t('qolSearch.collections.blockChooseTitle')}
      description={t('qolSearch.collections.blockChooseDescription')}
      onDismiss={() => done(null)}
      actions={[
        {
          id: 'cancel',
          label: t('common.cancel'),
          variant: 'secondary',
          leastDestructive: true,
          onPress: () => done(null),
        },
      ]}
    >
      <ul aria-label={t('qolSearch.collections.blockChooseTitle')}>
        {options.map((option) => (
          <li key={option.id}>
            <Button variant="quiet" onClick={() => done(option)}>
              {option.name}
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** The collections a block can show. The pages of the open section are always one of them. */
export function blockOptions(sectionId: string | null): CollectionDef[] {
  const here: CollectionDef[] = sectionId
    ? [{ ...emptyCollection('section', t('qolSearch.collections.thisSection')), section: sectionId, view: 'list' }]
    : [];
  return [...here, ...loadCollections()];
}

/** Asks which collection the new block shows. Resolves null when the person cancels or there is nothing to show. */
export async function chooseCollection(): Promise<CollectionDef | null> {
  const location = getLocation();
  const sectionId = location.view === 'workspace' ? location.sectionId : null;
  const options = blockOptions(sectionId);
  if (options.length === 0) return null;
  if (options.length === 1) return options[0];
  return showDialog<CollectionDef | null>((done) => <Chooser options={options} done={done} />);
}
