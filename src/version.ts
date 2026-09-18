// Bump these, and add an entry to RELEASE_NOTES, with every change that ships to users - see
// CLAUDE.md. There's a lot of work still planned, so instead of semver we use a date-based scheme
// that increments per release within a day: `{year}.{month}.{day}.{n}`, where `n` is the count of
// releases shipped that day (starting at 1). APP_PHASE tracks where the project is in its
// lifecycle (alpha -> beta -> ga, ...) and is prefixed onto the displayed version, e.g.
// "alpha_2026.9.18.3" for the 3rd release on 2026-09-18 during the alpha phase. Versions before
// this scheme (originally 0.1.0 - 0.7.2) have been renumbered into it retroactively so every
// entry in RELEASE_NOTES sorts and filters consistently.
export type AppPhase = 'alpha' | 'beta' | 'ga';
export const APP_PHASE: AppPhase = 'alpha';
export const APP_VERSION = '2026.9.18.14';
export const APP_VERSION_DISPLAY = `${APP_PHASE}_${APP_VERSION}`;

export type ReleaseNote = {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  notes: string[];
};

// Newest first. Entries up through "Create Object wizard for flows" are backfilled from git
// history (see `git log`) rather than written at release time, so their wording is reconstructed
// from commit messages.
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: 'alpha_2026.9.18.14',
    date: '2026-09-18',
    title: 'Stakeholder canvas view and Business Capability as a managed list',
    notes: [
      'Business Capability is now a managed list (Inventory > Reference Lists), picked from a dropdown instead of typed freely, so it can be relied on for grouping.',
      'Added a Stakeholder view alongside the existing canvas (now called Technical) - one box per Business Capability instead of every individual system, with connections rolled up and weighted by how many real system-to-system links back them. Systems with no capability assigned show under "Uncategorized" rather than disappearing.',
      'Clicking a Business Capability in the Stakeholder view jumps into the Technical view filtered to exactly that capability\'s systems and connections. The Technical view also gained a standalone "Filter by business capability" dropdown.',
      'Added an "Auto-arrange" button to the Technical view to declutter a busy landscape on demand - temporary for this viewing session only, never overwriting anyone\'s saved layout.',
    ],
  },
  {
    version: 'alpha_2026.9.18.13',
    date: '2026-09-18',
    title: 'System Owner role, approvals, and notifications',
    notes: [
      'Added a System Owner role: full write access to the systems they own (creating objects, and connections to or from an owned system), read-only everywhere else, same as a Viewer.',
      'A connection or flow-detail change that also touches a system the System Owner doesn\'t own is now held for approval instead of applying immediately - any Admin, or an owner of the other system, can approve or reject it. A pending change stays visible on the canvas (dashed, labeled "Pending") rather than disappearing.',
      'Added an Approvals page: decide changes awaiting your approval, track the status of your own requests, and withdraw one while it\'s still pending.',
      'Added in-app notifications (a bell in the header) for approval requests and decisions, and for existing ownership-change alerts - with a per-notification-type email opt-out under Profile > Notifications (in-app notifications themselves always stay on).',
      'Importing a bundle as a System Owner now applies the parts touching systems they own right away and queues the rest for approval, instead of failing the whole import.',
    ],
  },
  {
    version: 'alpha_2026.9.18.12',
    date: '2026-09-18',
    title: 'Dependencies auto-select and lock in Import/Export',
    notes: [
      'In both Export and Import, selecting something that depends on another system/object (an edge needs its two systems and the objects it carries; an object needs its master system) now ticks that dependency immediately, instead of only pulling it in silently behind the scenes.',
      'An auto-included dependency is shown ticked and locked (greyed out, with a lock icon) - the same convention used by installers and package managers for a required component - since it can only be removed by first deselecting whatever still needs it.',
      'Fixed a related bug: a system or object could end up skipped at commit time even though the checkbox showed it locked-and-included, if it had been individually skipped earlier and then became required again.',
    ],
  },
  {
    version: 'alpha_2026.9.18.11',
    date: '2026-09-18',
    title: 'Import preview now covers new items too',
    notes: [
      'The Import preview in Settings > Import / Export now lists every "new" system, data object, and edge in its own table (not just a count), each with a checkbox so it can still be excluded even though it doesn’t conflict with anything.',
      '"Include all" / "Skip all" bulk actions were added for new items, matching the existing bulk actions for conflicts.',
      'Skipping a new item that something else you’re still importing depends on now fails with a clear message instead of a raw database error.',
    ],
  },
  {
    version: 'alpha_2026.9.18.10',
    date: '2026-09-18',
    title: 'Selective Import / Export',
    notes: [
      'Added an "Import / Export" tab in Settings: pick specific systems, data objects, and edges and export them as a single JSON file - anything they depend on (an edge’s two systems and the objects it carries, an object’s master system) is pulled in automatically so the file always stands on its own.',
      'Importing a file shows exactly what’s new versus what already exists in this environment, and every conflicting id must be resolved - override, skip, or rename - individually or in bulk, before anything is written.',
      'Built for moving part of a landscape between environments (e.g. a local instance and the NAS) without a full database copy.',
    ],
  },
  {
    version: 'alpha_2026.9.18.9',
    date: '2026-09-18',
    title: 'Super Admin role and Server Settings',
    notes: [
      'Added a Super Admin role, one notch above Admin - the first account to ever run setup becomes one automatically, and only a Super Admin can grant or revoke Super Admin status on anyone else.',
      'Added a superadmin-only "Server Settings" tab in Settings, replacing the old Email tab, now also holding the Google Sign-In Client ID (configurable from the UI, no more editing secrets.env by hand).',
      'Added Super Admin recovery under Settings > Team: if no Super Admin can log in, any admin can request that one be promoted - it takes effect once every other admin approves by email, or immediately if there\'s only one admin.',
    ],
  },
  {
    version: 'alpha_2026.9.18.8',
    date: '2026-09-18',
    title: 'Sign in with Google',
    notes: [
      'Added "Sign in with Google" as an alternate way to log into an existing account (matched by email) - it does not create new accounts, so people still need to be invited via Settings > Team first.',
      'Hidden until an admin sets up a Google OAuth Client ID - see the README for the Google Cloud Console walkthrough.',
    ],
  },
  {
    version: 'alpha_2026.9.18.7',
    date: '2026-09-18',
    title: 'Profile picture, two-factor authentication, sessions, and account data',
    notes: [
      'Added a profile picture - upload a photo (shown in the header and Profile page) or get an auto-generated initials avatar if you don\'t set one.',
      'Added two-factor authentication (TOTP, via an authenticator app) under Profile > Security, with one-time backup codes for when you don\'t have your phone.',
      'Added a Sessions list under Profile - see every device/browser currently signed in to your account and revoke any that aren\'t this one.',
      'Added a Danger Zone under Profile: export a copy of your own data (profile plus anything you own) as a JSON file, or permanently delete your own account.',
    ],
  },
  {
    version: 'alpha_2026.9.18.6',
    date: '2026-09-18',
    title: 'Personal Profile page',
    notes: [
      'Added a Profile page - click your name in the header to open it - for account settings that are yours alone: your name and email, a password change, and the Language & Region and Appearance preferences moved here from the shared Settings page.',
      'Appearance (visual style, color palette, light/dark mode) is now saved to your account instead of just this browser, so it follows you to any device you sign in on, the same way Language & Region already did.',
      'Settings (Team, Email, Translations, Audit Log, Release Notes) is now purely shared/admin configuration, since the personal preferences moved to Profile.',
    ],
  },
  {
    version: 'alpha_2026.9.18.5',
    date: '2026-09-18',
    title: 'Shareable Schedule and Settings tab URLs',
    notes: [
      'The Schedule page (Upcoming Runs / Calendar) and Settings page (Appearance, Language & Region, etc.) now each write their active sub-tab into the URL, so refreshing or sharing the link reopens the same sub-tab instead of always resetting to the first one.',
    ],
  },
  {
    version: 'alpha_2026.9.18.4',
    date: '2026-09-18',
    title: 'Renumbered old releases into the new version scheme',
    notes: [
      'Every past release note (previously 0.1.0 - 0.7.2) was renumbered into the date-based alpha_{year}.{month}.{day}.{n} scheme, so version history sorts and filters consistently end to end.',
    ],
  },
  {
    version: 'alpha_2026.9.18.3',
    date: '2026-09-18',
    title: 'Date-based versioning and Release Notes search',
    notes: [
      'Switched from semantic versioning to a date-based scheme prefixed with the project phase (e.g. "alpha_2026.9.18.3"), since there\'s a lot of work still planned and semver numbers were incrementing too slowly to be useful.',
      'The Release Notes page now has a search box (matches title and note text) and filters by date and by version.',
    ],
  },
  {
    version: 'alpha_2026.9.18.2',
    date: '2026-09-18',
    title: 'Fixed missing translations in the Add menu',
    notes: [
      'The "Add System" and "Add Object" forms were showing raw translation keys (e.g. "canvas.newSystem") instead of translated text; fixed for all four supported languages.',
    ],
  },
  {
    version: 'alpha_2026.9.18.1',
    date: '2026-09-18',
    title: 'Toolbar and navigation tweaks',
    notes: [
      'Merged the canvas toolbar\'s separate "Add System" and "Add Object" buttons into a single "Add" button with a menu.',
      'Clicking the "EA Designer" logo now takes you to the Canvas view.',
      'Moved the Release Notes tab to the end of the Settings menu.',
    ],
  },
  {
    version: 'alpha_2026.9.17.3',
    date: '2026-09-17',
    title: 'Version number and release notes',
    notes: [
      'Added a version number in the corner of the app.',
      'Added this Release Notes page under Settings.',
    ],
  },
  {
    version: 'alpha_2026.9.17.2',
    date: '2026-09-17',
    title: 'Create Object wizard for flows',
    notes: [
      'Adding a data object to a new flow between two systems is now a guided 2-step wizard (name & classification, then description) instead of a free-text field that could silently create incomplete objects.',
      "The list of existing objects to choose from is now scoped to the flow's source system and filterable by name.",
    ],
  },
  {
    version: 'alpha_2026.9.17.1',
    date: '2026-09-17',
    title: 'Fixed a missing translation',
    notes: [
      'The Data Object panel\'s "Description" label was showing the raw translation key instead of translated text; fixed for all four supported languages.',
    ],
  },
  {
    version: 'alpha_2026.9.16.2',
    date: '2026-09-16',
    title: 'Single-origin deploys and NAS hosting',
    notes: [
      'The app now works correctly behind a reverse proxy or tunnel (e.g. Cloudflare) by routing API calls through the same origin as the page, instead of needing a second port reachable from the browser.',
      'Added the tooling to run this app both locally in Docker and as a Portainer stack on a NAS, kept in sync.',
    ],
  },
  {
    version: 'alpha_2026.9.16.1',
    date: '2026-09-16',
    title: 'Self-service password reset',
    notes: [
      'Added "forgot password" - a locked-out user can reset their own password via a one-time emailed link instead of needing a manual fix, and it signs out that account\'s other sessions.',
    ],
  },
  {
    version: 'alpha_2026.9.15.1',
    date: '2026-09-15',
    title: 'System object names, translations, ownership, and audit log',
    notes: [
      'Objects can now have a different name/ID in each system they live in, with search across all of them from Inventory.',
      "The app remembers which page and selection you had open across a refresh, and it's shareable via URL.",
      'Reference lists can no longer be deleted out from under something still using them without a resolution step.',
      'Every flow now requires its own schedule, and each integration is limited to one type/software.',
      'Added user language and time zone settings, and a full translation system (Settings > Translations) covering English, Czech, German, and Finnish, with CSV import/export and add/remove-language support.',
      'Settings is now split into Appearance, Language & Region, Team, Email, Translations, and Audit Log tabs.',
      'System and integration owners are now real user accounts (self-managed by the current owners) instead of free text, with change notifications and a warning when something has only one owner.',
      'Added a POC-phase NDA acceptance gate with a per-user audit trail.',
      'Added a full audit log of every view/create/update/delete and login event, with an admin-facing filterable report and CSV export.',
    ],
  },
  {
    version: 'alpha_2026.9.13.1',
    date: '2026-09-13',
    title: 'Per-object integration mechanics and the Schedule page',
    notes: [
      "Integration pattern, frequency, type, and software are now set per object flowing through a connection, not just once for the whole connection - since one connection can carry several objects integrated differently.",
      'Added Integration Types, Software, and Frequencies as admin-maintainable reference lists.',
      'Frequencies now use a real schedule (cron, interval, or daily/weekly at a time) instead of a free-text label.',
      'Added an "at risk" flag per object flow, planned system downtime windows, and a new Schedule page showing upcoming runs and a calendar, flagging any run affected by a downtime.',
    ],
  },
  {
    version: 'alpha_2026.9.12.2',
    date: '2026-09-12',
    title: 'User accounts, roles, and invites',
    notes: [
      'Added real login with admin/editor/viewer roles enforced on every action, not just hidden in the UI.',
      'Settings > Team lets admins invite teammates by email or link, manage roles, and remove members.',
      'Settings > Email lets admins configure the mail sender used for invites, verified against Gmail before saving.',
      'Added an app logo and favicon.',
    ],
  },
  {
    version: 'alpha_2026.9.12.1',
    date: '2026-09-12',
    title: 'Theming system and Settings page',
    notes: [
      'Added a Settings page with two visual styles (Enterprise Architecture, Material 3 Expressive), several color palettes, and light/dark mode.',
      'The Inventory page now has separate Systems and Data Objects tabs.',
    ],
  },
  {
    version: 'alpha_2026.9.11.2',
    date: '2026-09-11',
    title: 'Enterprise metadata, a real API, and the Inventory view',
    notes: [
      'Systems now track an owner, status, criticality, business capability, tech stack, and description; data objects track classification; connections track a description, pattern, and frequency.',
      'Every edit now saves itself individually instead of resyncing the whole diagram, so the app stays responsive as the landscape grows.',
      'Added an Inventory page: a searchable, filterable, paginated table of every system, as an alternative to the canvas for larger landscapes.',
    ],
  },
  {
    version: 'alpha_2026.9.11.1',
    date: '2026-09-11',
    title: 'Stability fixes',
    notes: [
      'Fixed overlapping arrows where two systems were directly connected through a shared junction.',
      "Auto-save no longer risks wiping the database if the backend isn't ready yet when the app loads.",
      'The app now works correctly when opened from a hostname other than "localhost".',
    ],
  },
  {
    version: 'alpha_2026.5.6.1',
    date: '2026-05-06',
    title: 'Initial prototype',
    notes: [
      'First version of the canvas: draw systems and the data flows between them.',
    ],
  },
];
