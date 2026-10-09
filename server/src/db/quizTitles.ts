// Seed quiz titles. Import-free on purpose: migrate.ts and the seeds both use it (a seed import
// from migrate.ts would create the cycle migrate -> seed -> db/index -> migrate). Never rename a
// title: seeds are idempotent by title, so a rename creates a duplicate quiz on the next deploy.
export const CHIDON_5787_ANFAENGER_TITLE = 'Chidon HaTanach 5787 – Anfänger (München)';
export const CHIDON_5787_FORTGESCHRITTENE_TITLE = 'Chidon HaTanach 5787 – Fortgeschrittene (München)';
export const CHIDON_5786_TITLE = 'European Chidon Tanach 5786 (January 2026)';
