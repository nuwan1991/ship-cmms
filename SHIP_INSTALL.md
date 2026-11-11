# SHIP INSTALLATION: STEP BY STEP

A fresh installation of the CMMS on a **Windows** computer on board, done by ship's staff. No programming knowledge is needed: follow the steps in order and compare what you see with the **You should see** lines. If something looks different, stop and see [If something goes wrong](#if-something-goes-wrong).

There are two parts:

- **Part A** is done **at HQ** by the system administrator, before the ship starts.
- **Part B** is done **on board** by ship's staff.

Part C is the test run. Part D is an AI prompt to use if you get stuck.

---

## Part A: prepared at HQ (administrator)

The ship receives one USB drive with everything on it, so nothing has to be built on board.

1. On a Windows 64-bit computer with internet, in the project folder:
   ```
   git pull
   npm ci
   npm run web:install
   npm run web:build
   npm run build:server
   ```
   If `npm ci` fails building `better-sqlite3` ("Windows SDK … was not found"), use `npm ci --ignore-scripts` and then `npm rebuild esbuild`.
2. Copy to the USB drive:
   - the **whole project folder** named `ship-cmms`, including `node_modules`, `dist` and `web\dist`, but **without** `data` and any `data-…` folders;
   - the **Node.js installer** for Windows 64-bit, version 22.23.4 or a later 22.x (not 23 or 24): the `.msi` file from nodejs.org.
3. At the hub: **Synchronization > Installations > Add installation**, kind *Ship*, choose the ship. **Save package file**. Rename it `ship-package.json` and put it **inside** the `ship-cmms` folder on the USB drive.
4. At the hub: **Identity & authority > Users per installation**: link the users who will sign in on this ship to the new installation. Without this nobody can sign in on board.
5. Fill in this box and give it to the ship with the USB drive:

   | | |
   |---|---|
   | Hub address | `http://______________:8080` |
   | User name for the test | `______________` |
   | Password | given separately, not written here |
   | HQ contact (phone / e-mail) | `______________` |

The package file holds a one-time secret: hand the USB drive over in person and keep it safe.

---

## Part B: on board (ship's staff)

Time needed: about 30 minutes. You need the USB drive, the box from step A5 and a Windows user that can install programs.

### B1. Install Node.js

1. On the USB drive, double-click the Node.js installer (`node-v22…-x64.msi`).
2. Click **Next** on every page, accept the licence and keep all the defaults. Click **Install**, then **Finish**.
3. If a black window opens after the installer asking to install "tools for native modules", close it; they are not needed.

### B2. Copy the program

1. Copy the `ship-cmms` folder from the USB drive to `C:\` so that it becomes `C:\ship-cmms`. This takes several minutes (many small files).
2. Open `C:\ship-cmms` and check that `ship-package.json`, `dist`, `node_modules` and `web` are in it.

### B3. Open PowerShell in the program folder

1. Open `C:\ship-cmms` in File Explorer.
2. Click in the address bar at the top, type `powershell` and press **Enter**. A blue or black window opens.
3. Type and press **Enter**:
   ```
   node -v
   ```
   **You should see** `v22.` followed by numbers (for example `v22.23.4`). If you see "not recognized", close the window, restart the computer and do B3 again.
4. Type and press **Enter**:
   ```
   npm run ops -- check
   ```
   **You should see** a list of checks without errors.

All later commands are typed in this same window. Copy each command exactly; the spaces and `--` matter.

> **Important:** never run `setup` on a ship computer. The ship *joins* the hub instead (next step).

### B4. Join the hub

Replace `HUB-ADDRESS` with the hub address from the box (for example `http://10.1.2.3:8080`):
```
npm run sync -- join --package ship-package.json --url HUB-ADDRESS
```
**You should see** `Joined as installation …`.

Do this **only once**. If it says the installation has already joined, go on to B5.

### B5. First synchronization

```
npm run sync -- run
```
This brings the ship's records, the users and the fleet lists from the hub. It can take a few minutes. **You should see** a block of text ending with `}` and no word `Error`.

Then **delete `ship-package.json`** from `C:\ship-cmms` **and** from the USB drive. It must not be used again.

### B6. Start the program

```
npm start
```
**You should see** a line saying the server is listening on port 8080. **Leave this window open**: closing it stops the program. To stop it on purpose, press **Ctrl+C** in this window.

### B7. Sign in

1. Open Chrome or Edge and go to `http://localhost:8080`.
2. Sign in with the user name and password from HQ. Change the password when asked.

**You should see** the menu, and on **Synchronization > Sync status** the time of the last synchronization.

### Starting again later

After the computer is restarted: open `C:\ship-cmms`, open PowerShell as in B3, type `npm start`, then open `http://localhost:8080`. Do **not** repeat B4 or B5.

---

## Part C: test run checklist

Tick each line and send the list to HQ.

| ✔ | Check | Where |
|---|---|---|
| ☐ | Signed in with own user | `http://localhost:8080` |
| ☐ | Ship name is correct and the ship's equipment is listed | **Assets > Asset register** |
| ☐ | Created a test defect (write "TEST" in the title) | **Maintenance work > Defects** |
| ☐ | Synchronized without an error | **Synchronization > Sync status > Synchronize now** |
| ☐ | HQ confirms they see the test defect | phone / e-mail HQ |
| ☐ | Took a backup | **Operations > Backups > Back up now** |
| ☐ | Verified the backup | **Operations > Backups > Verify** |
| ☐ | Copied the backup (both files: `.sqlite` and `.sqlite.json`) from `C:\ship-cmms\data\backups` to a USB drive kept elsewhere | File Explorer |
| ☐ | No red warnings | **Operations > System health** |
| ☐ | Stopped (Ctrl+C) and started again (`npm start`); still works | PowerShell |

Problems or remarks: ______________________________________________

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `'node' is not recognized` / `'npm' is not recognized` | Restart the computer, then B3 again. If it continues, install Node.js again (B1). |
| `node -v` shows `v23…` or `v24…` | Wrong version. Uninstall Node.js (Windows Settings > Apps) and install the one from the USB drive. |
| "running scripts is disabled on this system" | Type `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`, then repeat the command. |
| `Cannot find module` or `ENOENT` | The folder was not copied completely, or PowerShell is not in `C:\ship-cmms`. Copy the folder again (B2). |
| Join or synchronization: `fetch failed`, `ECONNREFUSED`, timeout | No connection to the hub. Check the internet, the hub address (including `http://` and `:8080`), and ask HQ whether the hub is running. Then repeat the same step. |
| Join: the package was already used / refused | Do not try again with the same file. Ask HQ for a new package file. |
| `npm start`: port 8080 already in use | The program is already running in another window. Use that one, or close it and start again. |
| Signing in: user unknown | HQ has not linked this user to the ship (A4). Ask HQ, then **Synchronize now** (or `npm run sync -- run`) and try again. |
| Anything else | Do **not** delete folders or run other commands. Take a photo of the screen and send it to HQ, or use the AI prompt below. |

---

## Part D: AI help prompt

Copy everything in the box into Claude (claude.ai) and add the screen text or a photo at the end.

```
I am installing a ship maintenance system (CMMS) on a Windows computer on board.
I am not a programmer. Please help me one step at a time, with exact commands to
type in PowerShell, and tell me what I should see after each one.

The setup:
- The program folder is C:\ship-cmms. It was prepared at HQ and copied from a USB
  drive, already built (node_modules, dist and web\dist are included).
- It needs Node.js 22.x (22.23.4 or later 22.x, not 23 or 24).
- This computer is a SHIP installation that joins an existing HUB at HQ.
  It must NEVER run "npm run ops -- setup" (that is only for a hub).
- The steps are:
  1. node -v
  2. npm run ops -- check
  3. npm run sync -- join --package ship-package.json --url <hub address>   (once only)
  4. npm run sync -- run          (first synchronization)
  5. npm start                    (keep the window open)
  6. open http://localhost:8080 in the browser and sign in
- Do not tell me to run npm ci or npm install, delete the data folder, or use
  --allow-other-installation, unless HQ has told me to. If a fix needs that, tell
  me to contact HQ instead.

I am at step: ___
What I typed: ___
What I see (copy the text or attach a photo): ___
```
