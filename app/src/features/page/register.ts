// Loads each work package's registrations (PLAN.md section 3.9, owned by WP0). Every package registers its
// commands, menus, bar items, settings parts, and renderers from its own file in registrations/, so no two
// packages edit one list. The files load at start-up, so each keeps its heavy code behind dynamic imports.

import.meta.glob('./registrations/*.ts', { eager: true });
