# OFFICE GUIDE: SLE (E&T) II – North

How to set up and use the **Office** part of Ship-CMMS. Release 1.0.
Section 1 is for the person who installs it. Sections 2 to 6 are for each kind of user. Section 7 is the acceptance checklist.

> **Security.** Only enter material up to **Restricted**. Run the system on the office computer only. It listens only on that computer (`127.0.0.1`) unless someone changes that on purpose. Turn on BitLocker, use a Windows password and screen lock, and keep backups on an encrypted USB drive in a locked place. Do not paste Restricted content into any AI or online service.

---

## 1. First-day setup (administrator)

Do this once, in order. Commands are typed in a terminal (PowerShell) in the program folder.

**1.1 Install the program.** Follow **OPERATIONS.md §1–2**: install Node.js 22, then `npm ci`, `npm run web:install`, `npm run web:build`, `npm run build:server`, and finally
`npm run ops -- setup --kind hub --code SLEN --name "SLE (E&T) II North" --admin admin`.
Write down the admin password it prints.

**1.2 Set up the office.**
```
npm run office -- setup
```
This creates the office reference numbers (TSK-, COR-IN-, COR-OUT-, MIN-, HOV-, EQM-, OWO-, SUP-) and the five office roles. It is safe to run again, for example after every upgrade.

**1.3 Start it.** `npm start`, then open `http://localhost:8080` in Chrome or Edge and sign in as **admin**.

**1.4 Create the dockyard.** *Organization → Commands → Add*. For example: code `DY-N`, name "Naval Dockyard North". This is the top of your structure.

**1.5 Build the office structure.** *Office → Office structure → Add unit*. Work top-down:
- **Department** (Fleet, Utility, Electronic …).
- **Section** (only where the department has sections).
- **Workshop**, under its section, or directly under the department when there are no sections.
- **Sub-section**, only inside a large workshop.

For each unit, set the **In-charge** and, for larger or important units, the **Officer (second)**. Then choose **Who verifies work**: *In-charge*, or *Officer must verify*. The Supply department is **not** entered here (see §4.6).

**1.6 Users who sign in.** *Identity & authority → Users → Add* for each person who will sign in (OIC, section officers, supervisors, clerks, technicians with a computer). Then use *Role assignments → Add*:

| Person | Role | Scope |
|---|---|---|
| Officer in charge | **OFC_OIC** (Officer in charge) | Command → your dockyard |
| Section officers, workshop in-charges, petty officers / supervisors, office clerk | **OFC_SUPERVISOR** | Command → your dockyard |
| Technical staff who sign in | **OFC_TECH** | Command → your dockyard |
| Anyone who only reads reports | **OFC_READONLY** | Command → your dockyard |
| The person who maintains the system | **OFC_ADMIN** | Command → your dockyard |

What each person *sees* is limited by their unit (see 1.7). The OIC, the admin and read-only users see the whole office.

**1.7 Personnel list.** *Office → Import existing registers → Personnel list*. Copy your nominal roll from Excel, including the heading row, and paste it. Press **Check rows**, fix any errors in Excel and paste again, then press **Register**. Then open each person who signs in under *Office → Personnel* and choose their **Sign-in account** under **Edit**. Without this link, their "My work" screen stays empty. A person with no account (for example a labourer) can still be given work.

**1.8 Old records.**
- **Handover annex:** *Office → Handover / takeover → New handover*. Fill it in, attach the signed handover document, then use **Paste from Excel** for the annex items.
- **Correspondence register and equipment register:** *Office → Import existing registers*. Old register numbers and dates are kept.
- **Supply demands:** *Office → Supply demands → Paste from logistics system*. First set your real stages under **Supply stages**.

**1.9 Backup.** *Operations → Backups → Back up now*, then **Verify**. Copy the backup file to the encrypted USB drive. The program also backs up by itself every 24 hours while it runs. To restore, see OPERATIONS.md §6.

---

## 2. Officer in charge

- **Dashboard** (*Office → Dashboard*) is your morning screen. Every number opens the list behind it. Orange outlines mean "overdue, not zero". Filter by section, person or priority.
- **Assign work.** Open a letter or handover item and press **Create task**, or use *Tasks → New task*. Choose the person, section and target date.
- **Approve work orders** (*Work orders (office)* → open → **Approve*). Enter the authority reference (minute, letter or signal). The system records who approved; it does **not** itself give approval authority.
- **Verify and close.** A task shows *Completed (to verify)* when the person who did it has finished. The in-charge or officer of that workshop, or anyone above them, presses **Verify and close**. You can verify anything. To close your own task you must write a self-closure note.
- **Reports** (*Office → Reports*): choose the report and period, then **Print / Save as PDF** for submission or **Excel** for editing. Every report ends with *Prepared by / Checked by* lines.
- **When someone is transferred**, open them under *Personnel* → **Reassign all work** to move their open tasks, handover items and letters to another person. Then set their duty status to *Transferred*. Their history stays.

## 3. Section officer / workshop in-charge / supervisor / clerk

- You see your own unit and everything below it, plus anything assigned to you.
- **Register letters.** *Correspondence → Register incoming*. Attach the scan, tick **Reply required** and set the **Reply due** date.
  - Choose the **Matter** to keep a file thread together.
  - The system warns if the same reference and date were already registered.
- **Register replies** from the letter (**Register reply**). Mark them **Dispatched** when sent. The original letter then leaves the "awaiting reply" list.
- **Correcting** a reference number, date, subject or sender needs a reason. The old and new values are kept. **Cancel record** also needs a reason. Nothing is ever deleted.
- **Tasks:** assign, reassign (give a reason), add subtasks, and verify and close your staff's completed work.
- **Equipment:** *Equipment register → Register equipment*. Tick **Received for repair now** when a unit brings something in. Then record each movement:
  - *Send to workshop / agency* (with expected return)
  - *Returned from agency*
  - *Repair completed*
  - *Collected by owner*

  For loans, use *Issue temporarily* with a return date, and *Returned from issue*.
- **Work orders:** **Raise work order** from a letter or from equipment. Assign the workshop, supervisor and crew. Set *Awaiting spares* / *Awaiting external support* while waiting. **Add supply demand** records the demand number.

## 4. Things that work the same everywhere

1. **Overdue** means the target or reply date has passed and the item is not finished. Moving an overdue item on, or moving its date later, asks for the **reason for delay**.
2. **History** at the bottom of every record shows who did what and when, including comments, progress notes, assignments, status changes and corrections.
3. **Documents and photos**: **Attach file…** on any record. Tick **Restricted file** for Restricted scans. Only the OIC (and others given that right) can open those.
4. **Search and filters** are at the top of every list.
5. **Paste from Excel** always checks first. Nothing is saved until you press Register or Apply.
6. **Supply department.** Supply is not part of the office structure; its demands are tracked under *Supply demands* by their **Supply / logistics reference**. Pasting rows copied from the logistics system again later updates each demand's stage. Rows already up to date are left alone.

## 5. Technical staff: "My work"

1. Sign in. On a phone, press **☰ Menu** for other screens.
2. **My work** shows only your jobs, with the most urgent first.
3. Press **▶ Started** when you begin.
4. If you are stuck, write what you need in the box and press **? Need info**.
5. When finished, write what you did and press **✓ Done**. Your supervisor then checks it.
6. **📷 Photo** adds pictures to the job.
7. If the job is late, the screen asks **"Why is it late?"** first.

## 6. Administrator

- Users, roles and role assignments are under *Identity & authority*. Keep the five office roles. If you change their permissions, run `npm run office -- setup` again: it adds anything missing and never removes your additions.
- *Operations → System health / Backups / Data checks*: check them weekly. **Verify** a backup at least monthly.
- **Upgrades** (OPERATIONS.md §7): back up first, install, start, then run `npm run office -- setup`.
- **Office settings:** under *Supply demands*, the **Supply stages** button edits the stage list, one stage per line.

---

## 7. User acceptance checklist (sign before Version 1.0 is used)

Work through it on the office computer with real names and a few real records. Tick each one, write a remark if needed, and sign at the end.

| # | Check (requirement §11) | How | OK |
|---|---|---|---|
| 1 | Register a new incoming letter and create a linked task | Correspondence → Register incoming → open it → Create task. The task shows "Created from" the letter | ☐ |
| 2 | Assign and track the task until closure | Assign → Started → Mark completed (as the assignee) → Verify and close (as the in-charge) | ☐ |
| 3 | Handover items imported and monitored | Handover → New handover → Paste from Excel (your annex) → Progress report | ☐ |
| 4 | Equipment repair and temporary issue records | Register equipment (received for repair) → send out → return → collected; issue a meter and return it | ☐ |
| 5 | Work orders assigned, progressed, verified, closed | Raise from equipment → Approve (OIC) → Assign → Start → Mark completed → Verify work → Close | ☐ |
| 6 | Dashboard matches the records | Click three dashboard numbers: each list shows the same count | ☐ |
| 7 | Overdue correctly identified | Give a task yesterday's date: it is orange on the dashboard, in Tasks → Overdue and in the Overdue task report | ☐ |
| 8 | Reports generated and printed | Reports → each of the 10 → Print / Save as PDF and Excel | ☐ |
| 9 | No access to unauthorised records | Sign in as a supervisor of one workshop: another workshop's tasks are not listed. A Restricted letter shows "[Restricted]" | ☐ |
| 10 | Changes traceable | Correct a letter's reference (with a reason): History shows old → new, who and when | ☐ |
| 11 | Backup and restore | Back up now → Verify → (on a spare copy) restore as in OPERATIONS.md §6 | ☐ |
| 12 | Existing data intact | After all the above, Operations → Data checks shows no problems; earlier records unchanged | ☐ |

Accepted for operational use (Version 1.0):

Officer in charge: ______________________  Date: ____________  Remarks: ______________________
