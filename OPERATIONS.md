# OPERATIONS

How to install, run, back up, restore, upgrade and join installations. Written for the person who looks after a hub or a ship installation. Commands run in the project folder.

## 1. What you need

- Node.js 22.23.4 or a later 22.x (not 23 or 24). Older 22.x releases crash on Windows when the database opens. `node -v` shows it.
- About 1 GB of free disk space and a folder for the data.
- Nothing else: no database server, no internet after installation.

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
