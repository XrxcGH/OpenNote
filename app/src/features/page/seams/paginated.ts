// Whether the shown page is in the paginated view. The page view's paper code (features/pages/live/controller.ts)
// sets it; the page commands read it, so start-up code needs none of the pages feature.
import { createStore } from '../../../state/store';

export const shownPaginated = createStore<boolean>(false, 'shown page is paginated');
