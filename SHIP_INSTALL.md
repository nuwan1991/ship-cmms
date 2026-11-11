# SHIP INSTALLATION: STEP BY STEP

A fresh installation of the CMMS on a **Windows** computer on board, done by ship's staff. No programming knowledge is needed: follow the steps in order and compare what you see with the **You should see** lines. If something looks different, stop and see [If something goes wrong](#if-something-goes-wrong).

There are two parts:

- **Part A** is done **at HQ** by the system administrator, before the ship starts.
- **Part B** is done **on board** by ship's staff.

Part C is the test run. Part D is an AI prompt to use if you get stuck.

---

## Part A: prepared at HQ (administrator)

The ship receives one USB drive with everything on it, so nothing has to be built on board. Part A has two jobs:

- **A1–A8: build the program and copy it to a USB drive**, together with the Node.js installer.
- **A9–A11: prepare the ship at the hub**: the package file, the users and the information box.

Allow about an hour the first time, mostly waiting for downloads and copying.

### Build the USB drive step by step

**What you need:** a Windows 10 or 11 computer, **64-bit**, with internet. Use the same kind of Windows as the ship computer, because the program contains parts made for 64-bit Windows. You also need a USB drive of at least **4 GB** (8 GB or more is easier), and a GitHub account that can read `nuwan1991/ship-cmms`.

#### A1. Install the tools on the HQ computer (first time only)

1. **Node.js 22:** go to `https://nodejs.org/en/download`, choose version **22** (the "LTS" line that starts with `v22.`), **Windows Installer (.msi), x64**. Check that it is **22.23.4 or newer, but still 22.x**. Not 23 or 24.
   Run it and click **Next** through all pages, keeping the defaults.
   **Keep the downloaded `.msi` file**: it also goes on the USB drive (A7).
2. **Git:** go to `https://git-scm.com/download/win`, download **64-bit Git for Windows Setup** and install it with the default choices.
3. **Restart the computer** so that Windows finds both programs.
4. Check: open the Start menu, type `powershell`, open **Windows PowerShell** and type:
   ```
   node -v
   npm -v
   git --version
   ```
   **You should see** `v22.…`, a number such as `10.…`, and `git version …`. If one says "not recognized", install that program again and restart.
5. If later commands say "running scripts is disabled on this system", type this once and answer `Y`:
   ```
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```

#### A2. Get the latest program from GitHub

Use a working folder such as `C:\build`. In PowerShell:

**First time:**
```
mkdir C:\build
cd C:\build
git clone https://github.com/nuwan1991/ship-cmms.git
cd C:\build\ship-cmms
```
Windows asks you to sign in to GitHub in a browser window the first time: sign in with the account that can read the repository.

**Later times** (the folder already exists):
```
cd C:\build\ship-cmms
git checkout master
git pull
```

Check that you have the latest version:
```
git log --oneline -1
```
**You should see** the same latest commit as on the GitHub page of the repository (branch `master`).

> Do not build from the HQ hub's own working folder: build in `C:\build` so the hub's `data` folder can never end up on the USB drive.

#### A3. Download the program's parts

```
npm ci
```
This downloads everything the program needs into `node_modules`. It takes a few minutes. **You should see** a final line like `added … packages` and no `ERR!`.

If it fails with a message about `better-sqlite3` and "Windows SDK … was not found", run instead:
```
npm ci --ignore-scripts
npm rebuild esbuild
```
(The database part comes ready-made for Windows, so it does not need to be built.)

Warnings (`npm warn …`) are normal; only `npm ERR!` is a failure.

#### A4. Download the screens' parts

```
npm run web:install
```
**You should see** `added … packages` and no `ERR!`.

#### A5. Build the screens and the server

```
npm run web:build
npm run build:server
```
**You should see** the first one end with `built in …`, and both end without `error`. Afterwards these folders exist:

- `C:\build\ship-cmms\dist` (the server)
- `C:\build\ship-cmms\web\dist` (the screens)

#### A6. Quick test that the build works

```
npm run ops -- check
```
**You should see** the list of checks without errors. Then check that the server starts, using a throw-away data folder so nothing is left behind:
```
$env:CMMS_DATA_DIR = "C:\build\test-data"; npm start
```
**You should see** `CMMS listening on 127.0.0.1:8080 (uninitialized), web app served`. Open `http://localhost:8080` in a browser: the sign-in page should appear (you cannot sign in; there are no users, which is fine). Press **Ctrl+C** to stop it, then remove the test settings and data:
```
Remove-Item Env:CMMS_DATA_DIR
Remove-Item -Recurse -Force C:\build\test-data
```

#### A7. Copy everything to the USB drive

1. Plug in the USB drive. In File Explorer note its letter, for example `E:`. Format it as **NTFS** or **exFAT** if it is FAT32 (FAT32 is slow with many small files).
2. Copy the program folder **without** any data folders. In PowerShell, replacing `E:` with your drive letter:
   ```
   robocopy C:\build\ship-cmms E:\ship-cmms /E /XD data data-* .git /NFL /NDL /NP
   ```
   `/XD` leaves out the `data` and `data-…` folders (they must never travel to a ship) and the `.git` history (not needed on board). This copies tens of thousands of small files and can take 5–20 minutes. **You should see** a summary table at the end with `0` in the **FAILED** column.
3. Copy the Node.js installer (`node-v22….-x64.msi`, usually in your **Downloads** folder) to the top of the USB drive, `E:\`.

#### A8. Check the USB drive

On the USB drive, check:

| Must be there | Must **not** be there |
|---|---|
| `E:\node-v22.…-x64.msi` | `E:\ship-cmms\data` |
| `E:\ship-cmms\package.json` | any `E:\ship-cmms\data-…` folder |
| `E:\ship-cmms\dist\main.js` | any old `ship-package.json` from an earlier ship |
| `E:\ship-cmms\web\dist\index.html` | |
| `E:\ship-cmms\node_modules` (a very large folder) | |

A quick check of the size in PowerShell:
```
"{0:N0} MB" -f ((Get-ChildItem E:\ship-cmms -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
```
It should be several hundred MB. Only a few MB means `node_modules` is missing: repeat A7.

The same USB drive contents (without the package file) can be reused for every ship that has the same version. Rebuild (A2–A8) when the program has changed.

### Prepare the ship at the hub

#### A9. Package file

At the hub: **Synchronization > Installations > Add installation**, kind *Ship*, choose the ship. **Save package file**. Rename it `ship-package.json` and put it **inside** `E:\ship-cmms` on the USB drive. Each ship needs its own package file, used once.

#### A10. Users

At the hub: **Identity & authority > Users per installation**: link the users who will sign in on this ship to the new installation. Without this nobody can sign in on board.

#### A11. Information for the ship

Fill in this box and give it to the ship with the USB drive:

| | |
|---|---|
| Hub address | `http://______________:8080` |
| User name for the test | `______________` |
| Password | given separately, not written here |
| HQ contact (phone / e-mail) | `______________` |

The package file holds a one-time secret: hand the USB drive over in person and keep it safe.

---

## Part B: on board (ship's staff)

Time needed: about 30 minutes. You need the USB drive, the information box from HQ (step A11) and a Windows user that can install programs.

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
| Signing in: user unknown | HQ has not linked this user to the ship (step A10). Ask HQ, then **Synchronize now** (or `npm run sync -- run`) and try again. |
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
