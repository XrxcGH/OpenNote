// The open page that is shown, for page history (owner: WP7). mount.ts sets it beside the other shown stores.
import type { OpenPage } from '../../../services/pages/types';
import { createStore } from '../../../state/store';

export const shownPage = createStore<OpenPage | null>(null, 'shown open page');
