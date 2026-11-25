# RELEASE NOTES: Fleet CMMS

Office-only changes are listed in more detail in [OFFICE_RELEASE.md](OFFICE_RELEASE.md).

## Version 1.3.0, 25 Nov 2026

Download: https://github.com/nuwan1991/ship-cmms/archive/refs/tags/v1.3.0.zip (or the `master` ZIP, which is this version until the next release).

### New: Docking (M16)

A new **Docking** menu for planning and recording ships' dry-docking (DECISIONS D75, D76).

| Screen | What it does |
|---|---|
| Docks | The docking facilities: graving dock, floating dock, slipway, ship lift, with size limits and how many ships each takes at once |
| Docking schedule | Every planned, current and past docking, with checklist and work-list progress, lateness, and warnings when two ships are planned into one single-ship dock at the same time |
| Docking page | Planned → Docked in → Undocked → Completed (or Cancelled). Pre-docking requirements, the docking work list (each item can raise a maintenance work order), the underwater survey (hull, propeller, shaft, rudder, anodes…) and, on completion, when the next docking is due |
| Docking due | Every ship: overdue, due within 90 days, never docked, in dock, or not yet due |
| Checklist templates | The standard pre-docking checklist of each ship class (by the **Ship class** on the ship record), and one for every ship |
| Ship requirements | Standing pre-docking items of one ship, added on top of its class template |

Rules: a ship cannot be docked into a full or inactive dock, nor into two docks at once; a ship cannot have two dockings planned for the same dates; mandatory pre-docking items still pending block dock-in unless someone allowed to waive them gives a reason; a docking can be completed only when every work-list item is done, deferred or cancelled.

### Fixed

| Area | Fix |
|---|---|
| Upgrades | An upgrade no longer stops with "Migration … was modified after being applied" when the program was copied with different line endings than the installed one (for example installed from the GitHub ZIP, upgraded from a `git clone` build on Windows). Real changes are still refused. `.sql` files are now always stored with LF (D77) |

### Included from earlier versions

Office Version 1.0–1.2 (SLE (E&T) II – North office: correspondence, handover, tasks, personnel, equipment, office work orders, supply demands, reports, attendance). See [OFFICE_RELEASE.md](OFFICE_RELEASE.md).

### Upgrading to 1.3.0

1. Follow [OPERATIONS.md §7](OPERATIONS.md#7-upgrade): back up, install the new version, start it. The database changes (`M16/0001_docking`, `M16/0002_requirements`) are applied at start, after an automatic backup. No command needs to be run afterwards.
2. Upgrade the **hub first**, then the ships. Docks and checklist templates are set up at the hub and reach every ship.
3. Give the roles that should use docking the `dck.*` permissions (*Identity & authority → Roles*). The fleet administrator (`*`) has them already. Only give `dck.requirement.waive` to those allowed to dock a ship in with requirements outstanding.
4. Check that every ship has its **Ship class** filled in (*Organization → Ships*), so that the class checklist templates apply to it.

### Checks run for this release

- `npm run verify`: typecheck, module boundaries, 379 server tests.
- `npm run verify:web`: web typecheck, 57 web tests, production build.
- Upgrade drill: a database created by v1.2.0 (with Windows line endings) upgraded to 1.3.0 with a backup first; data checks clean.
- Production build (`npm run build:server`, `npm run web:build`) started with `npm start` on a new installation, and on the upgraded database.
- The docking workflow and the pre-docking checklist used end to end in the browser.

### Known limits

1. Ship dimensions are not recorded, so the system cannot check that a ship fits a dock.
2. Docking in does not change the ship's operational status; record that in *Organization → Operational status* as before.
3. There is no docking report under *Reports* yet; the schedule and the Docking due screen are the overview.
