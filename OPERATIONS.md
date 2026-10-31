# OPERATIONS

How to install, run, back up, restore, upgrade and join installations. Written for the person who looks after a hub or a ship installation. Commands run in the project folder.

## 1. What you need

- Node.js 22.23.4 or a later 22.x (not 23 or 24). Older 22.x releases crash on Windows when the database opens. `node -v` shows it.
- About 1 GB of free disk space and a folder for the data.
- Nothing else: no database server, no internet after installation. For a machine that never has internet, prepare everything on one that does and carry it over: see section 11.

Check the machine: `npm run ops -- check`.

## 2. Install the hub (once)

```
npm ci
npm run web:install
npm run web:build                  # builds the screens
npm run build:server               # compiles the server into dist/
npm run ops -- setup --kind hub --code HQ --name "Fleet HQ" --admin admin
```
`setup` creates the data folder (`./data`, or `CMMS_DATA_DIR`), the database, the hub identity and the first administrator. If you do not give `--password`, a password is printed once: write it down and change it after signing in.

Start it: `npm start` (runs `node dist/main.js`). One program serves the API and the screens on `http://<machine>:8080`. Use `CMMS_HOST=0.0.0.0` to allow other computers on the network, and `CMMS_PORT` to change the port. During development `npm run dev` and `npm run web:dev` can be used instead.

Settings are environment variables: `CMMS_DATA_DIR`, `CMMS_DB_FILE`, `CMMS_HOST`, `CMMS_PORT`, `CMMS_DISPLAY_TZ` (default Asia/Colombo), `CMMS_WEB_DIR` (or `off`), `CMMS_BACKUP_EVERY_HOURS` (24, 0 = off), `CMMS_BACKUP_KEEP` (14), `CMMS_BACKUP_WARN_DAYS` (7). `CMMS_DEV_AUTH=1` turns sign-in off and is for development only.

Run it as a service so it starts with the machine (systemd on Linux, a scheduled task or NSSM on Windows). Stop it with Ctrl+C or SIGTERM; it closes the database cleanly.

## 3. First set-up of the data (hub)

```
npm run seed:demo-org          # optional demo ships and locations
npm run asset-tags -- setup    # number ranges (see each module's CLI)
npm run label-numbers -- setup
npm run work-numbers -- setup
npm run store-numbers -- setup
```
Then sign in and use the screens. Excel import (Data > Excel) loads locations, assets and parts in bulk.

## 4. Add a ship, workshop or command

At the hub, in the web app: **Synchronization > Installations > Add installation** (or `npm run sync -- provision --kind ship --code SLNS-01 --name "SLNS Example" --scope <ship id> --out package.json`). Choose which ships it follows. Save the package file: it holds a one-time secret.

On the new machine, install as above (steps 1 and 2, but **do not run `setup`**), then:
```
npm run sync -- join --package package.json --url http://<hub address>:8080
npm run sync -- run
```
The first exchange brings the fleet reference data, the ship's own records, the users provisioned to it and its number ranges. Delete the package file afterwards. Sign in with a user that the hub administrator linked to this installation.

**No network link?** Use files: at the hub, *Synchronization > Files (USB)* creates a file for the installation; on the ship, read it, then create a file for the hub and carry it back. Files are signed; a damaged or altered file is refused, and reading the same file twice does nothing.

Synchronize regularly. An installation that has not synchronized for 7 days (ships) or 2 days (others) is shown as out of date on every report.

## 5. Backups

- The application makes a backup every 24 hours while it runs and keeps the newest 14. Manual backups (*Operations > Backups > Back up now*, or `npm run ops -- backup`) and the ones taken before an upgrade or restore are never removed automatically.
- Backups are in `<data folder>/backups` with a `.json` file beside each. **Copy them off the machine** (another disk, a USB drive kept elsewhere); a backup on the same disk does not survive the disk.
- A backup contains everything, including the installation's signing key and the password hashes. Keep copies as carefully as the machine.
- *Verify* a backup (button, or `npm run ops -- verify --file <backup>`) now and then; an unverified backup is only a hope. The health screen warns when none has been made or verified.

## 6. Restore

With the application **stopped**:
```
npm run ops -- verify  --file <backup file>
npm run ops -- restore --file <backup file>
```
The current database is kept first as a "before a restore" backup. Start the application and synchronize: a hub restored from an old backup tells each ship what it holds, and the ships send everything newer again. Do not hand out new number ranges until every installation has synchronized.

Replacing failed hardware: install on the new machine, copy the backup and the same-named data folder, and restore with `--allow-other-installation`. The new machine becomes that installation.

Never provision a new machine for a ship that still has unsent changes: first create a file with *Emergency: include everything ever written here*.

## 7. Upgrade

1. Take a backup (`npm run ops -- backup`) and copy it away.
2. Stop the application, install the new version (`git pull`, `npm ci`, `npm run web:install`, `npm run web:build`, `npm run build:server`).
3. Start it. Pending database changes are applied at start, **after an automatic backup** (named `pre_upgrade`). `npm run migrate` does the same without starting.
4. Upgrade the hub first. A ship on an older version keeps working; changes written by a newer version wait in *Synchronization > Conflicts* ("sent by a newer version") until that ship is upgraded, then *Retry held changes*. Installations more than one step apart refuse each other's changes.

## 8. Everyday checks

- *Operations > System health*: warnings about backups, disk space, pending changes.
- *Operations > Data checks* (`npm run ops -- integrity`): finds records that point to something missing, overlapping number ranges, a ship attached to two commands, negative stock. It reports; it never changes data. Run it after a restore or a long period offline.
- *Synchronization > Sync status* and *Conflicts*: a conflict means two versions of one record exist; the owner chooses which stands.
- *Reports > Overview* and *Notifications*: the working picture. Every report states when its data was last synchronized.

## 9. Security notes

- Passwords are stored as scrypt hashes. Sessions are in the database.
- Disk encryption is left to the operating system (BitLocker, LUKS); enable it on every machine that holds data.
- Provisioning packages and backups are secrets. Both are written readable by the owner only.
- Bind to the loopback address (default) unless other computers must reach it; put the hub behind the network's usual protections.

## 10. A hub and a ship on one computer (testing)

For trying synchronization, offline work and USB files without a second machine. Both installations run from the same project folder; what makes them separate is the **data folder** and the **port**. Each has its own database, backups, users and signing key, so to each other they are as separate as two computers.

| | Hub | Ship |
|---|---|---|
| Data folder (`CMMS_DATA_DIR`) | `data` (default) | `data-ship` |
| Port (`CMMS_PORT`) | 8080 (default) | 8081 |
| Screens | `http://localhost:8080` | `http://localhost:8081` |

Folders named `data-…` are ignored by git, like `data`. Commands below are for Windows PowerShell; on Linux write `CMMS_DATA_DIR=data-ship npm run …` instead.

1. Install and set up the hub as in sections 2 and 3, build the screens (`npm run web:build`) and start it (`npm start`, or `npm run dev`).
2. At the hub: **Synchronization > Installations > Add installation**, kind *Ship*, the ship it serves (for example DEMO-101). Choose **Save package file**; it downloads as `provision-DEMO-101.json`. Move it into the project folder and rename it `ship-package.json`.
3. At the hub: **Identity & authority > Users per installation**: link every user who will sign in at the ship (for a test, `admin`) to the new installation. Only linked users are sent to the ship; without this step nobody can sign in there. Linking a user later works too: it arrives at the ship's next synchronization.
4. Join, in a second terminal (do **not** run `setup` for the ship):
   ```
   $env:CMMS_DATA_DIR = "data-ship"; npm run sync -- join --package ship-package.json --url http://localhost:8080
   $env:CMMS_DATA_DIR = "data-ship"; npm run sync -- run
   ```
   The first run brings the fleet lists, the ship's records, its users and its number ranges. The hub address is remembered, so later runs need no `--url`. Delete the package file afterwards.
5. Start the ship in its own terminal:
   ```
   $env:CMMS_DATA_DIR = "data-ship"; $env:CMMS_PORT = "8081"; npm run dev
   ```
   Open `http://localhost:8081` and sign in with a linked user. Use the ship's own address, not `http://localhost:5173`: the screen development server on 5173 talks only to the hub. Both servers show the built screens, so run `npm run web:build` again after changing them.
6. Synchronize from the ship with **Synchronization > Sync status > Synchronize now** (hub address `http://localhost:8080`), or step 4's `sync -- run`.

The browser keeps a separate sign-in for each address, so the hub and the ship can be open in two tabs. Records keep their owner: ship records entered at the hub arrive at the ship read-only; records entered at the ship belong to the ship. To try working cut off, stop the hub, keep working on the ship, then start the hub and synchronize; or exchange **Files (USB)** between the two. To start again, stop the ship, delete `data-ship`, and decommission it at the hub (**Synchronization > Installations > Decommission**).

## 11. Move an installation to a machine without internet

Prepare on a machine with internet, then carry the software and a backup across. It works for any installation: hub, ship, workshop or command.

**The software.** Installing needs the internet only to download; the result runs anywhere of the same kind.

1. On the internet machine, download the Node.js installer for the offline machine (version 22.23.4 or a later 22.x).
2. In the project folder:
   ```
   npm ci
   npm run web:install
   npm run web:build
   npm run build:server
   ```
   On Windows, if `npm ci` fails building `better-sqlite3` ("Windows SDK … was not found"), use `npm ci --ignore-scripts` and then `npm rebuild esbuild`: the package ships a ready-made Windows program, so nothing needs building.
3. Copy the **whole project folder**, including `node_modules`, `dist` and `web/dist`, and the Node.js installer to the offline machine (USB drive). Leave out `data` and any `data-…` folders.
4. On the offline machine, install Node.js and **do not run `npm ci` or `npm run web:install`** there: they need the internet. The copied folder already has everything.

Both machines must be the same kind (for example 64-bit Windows on both). For a Linux offline machine, do step 2 on a Linux machine with internet.

**The data.**

1. On the internet machine: **Operations > Backups > Back up now** (or `npm run ops -- backup`), then **Verify** it.
2. Stop the application there.
3. Copy **both** files of that backup from `data/backups` to the USB drive: the `.sqlite` file and the `.sqlite.json` beside it.
4. On the offline machine, **without running `setup`**:
   ```
   npm run ops -- verify  --file <backup file>
   npm run ops -- restore --file <backup file>
   ```
   If `setup` was run there already, the restore refuses ("This backup belongs to a different installation"). Then add `--allow-other-installation`; the database that was there is kept as a "before a restore" backup.
5. Start it (`npm start`) and sign in with the same users and passwords. Work continues from the moment of the backup. For ships and workshops to reach it over the local network, start it with `CMMS_HOST=0.0.0.0`; they then use `http://<its address>:8080`.

**The installation moves; it is not copied.** The backup carries the installation's identity: its signing key, its number ranges and the records it owns. After the restore, the offline machine *is* that installation. Do not keep using the old copy: both would hand out the same equipment tag and work order numbers, and synchronization would report the clashes as conflicts. Rename or delete the old machine's `data` folder once the move is done.
