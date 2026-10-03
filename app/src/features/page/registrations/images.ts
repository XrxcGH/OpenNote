// WP5's registrations for images and paste (PLAN.md section 2, rule 3). The start-up bundle has no room for them,
// so they load in their own chunk right after start-up (images/register.ts). Paste, drop, and copy listen on the
// page view itself (images/attach.ts).
void import('../images/register');
