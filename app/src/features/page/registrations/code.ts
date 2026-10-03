// WP6's registrations for code (PLAN.md section 2, rule 3). This file loads at start-up, so it only installs the
// language picker that code blocks' language buttons open, which loads on first use. Set code language and Leave
// code block register from their own chunk in idle time.
import { setLanguagePicker } from '../../../editor/highlight/picker';
import { announce } from '../../../ui';
import { later } from '../tables/later';

setLanguagePicker((request) => {
  void import('../code/picker').then(({ openLanguagePicker }) => openLanguagePicker(request, { announce }));
});

later(() => import('../code/register'));
