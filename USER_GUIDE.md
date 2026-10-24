# USER GUIDE

How to use Fleet CMMS day to day: reporting defects, running work orders, planned maintenance, stores, labels, surveys and reports. Written for the people who use the screens. For installing, backing up and upgrading, see [OPERATIONS.md](OPERATIONS.md).

Words in **bold** are the names of menus, buttons and fields exactly as they appear on screen.

---

## 1. Before you start

### What the system is

Fleet CMMS keeps the maintenance records of a fleet: the ships, the equipment fitted in them, the defects found, the work done, planned maintenance, spare parts and stock.

It is made of **installations**. Each one is a copy of the program with its own database:

- The **hub** at headquarters holds the fleet-wide lists (commands, ships, workshops, part catalogue) and hands out number ranges.
- Each **ship** (and, if needed, each workshop or command) has its own installation. It keeps working with no network at all, including approvals.
- Installations **synchronize** with the hub over the network or by carrying a file on a USB drive. Each one receives only the ships it follows.

The top bar always shows which installation you are on (for example *Installation: Fleet HQ (HQ)*) and the time zone used for all times (*Times shown in Asia/Colombo*).

### A few rules that apply everywhere

- **Nothing is ever deleted.** **Remove** takes a record out of the lists, but it stays in the database and in the audit trail. Most removals ask for a **Reason**.
- **Records that are in use cannot be removed.** A part with stock history, a meter with readings or a work order with work recorded against it is marked **Inactive** or **Closed** instead. The message on screen tells you which.
- **Each record belongs to one installation.** You can change only the records your installation owns. Lists kept at headquarters show *"This list is maintained at headquarters. This installation can read it but not change it."*
- **Times you enter are local time.** Where a form has a **When** field, leave it empty to mean "now". Fill it in only when you are recording something that already happened.
- **Equipment tags never change.** An equipment tag such as `SLN-EQ-00000001` is given when the asset is registered and stays with it for life, even if it moves to another ship.

### Is the data up to date?

Lists and reports show a line about how fresh the data is:

| Message | Meaning |
|---|---|
| *Headquarters data: this installation is the authoritative source.* | You are on the hub. |
| *Data is up to date with headquarters.* | Synchronized recently. |
| *Data may be out of date. Last synchronized …* | Not synchronized for a while (7 days for ships, 2 for others). Synchronize. |
| *This installation has not synchronized with headquarters yet.* | A new installation that has never exchanged data. |
| *… local change(s) waiting to synchronize.* | Changes made here that the hub has not received yet. |

---

## 2. Signing in

1. Open the address your administrator gave you, for example `http://localhost:8080`.
2. Enter your **Username** and **Password** and choose **Sign in**.
3. The **Overview** screen opens.

To change your password, choose **Change password** in the top bar, enter your **Current password** and a **New password**. Choose **Sign out** when you leave the computer.

The menu on the left shows only what your role allows. If you cannot find a screen described here, you do not have the permission for it: ask your administrator.

### Messages in the top bar

- *Offline authority valid until …*: this installation may approve work on its own until that date. After it, it must synchronize with headquarters.
- *Offline authority on this installation has expired.* Routine work continues, but approvals are recorded as **pending confirmation** and administration is blocked until the installation synchronizes.
- *The system clock is behind the last recorded time.* Approvals are blocked until an administrator corrects the computer's clock.

### When someone else changed the record

If two people edit the same record, the second one to save sees *"This record was changed by someone else"*. Choose **Reload latest** to see the other person's version (your edits are lost), or **Save my edits anyway** to save yours over it.

---

## 3. The menu at a glance

| Menu | Screens | Used for |
|---|---|---|
| **Reports** | Overview, Reports, Notifications | The working picture: open work, maintenance due, low stock |
| **Organization** | Commands, Ships, Departments, Workshops, External providers, Locations, Fleet | Who and where: the fleet structure |
| **Assets** | Asset register, Positions, Classifications, Legacy mapping | The equipment fitted in each ship |
| **Identity & authority** | Users, Roles, Role assignments, Approval gates, Offline authority, Users per installation, Pending confirmation, Revocations | Who may do what (administrators) |
| **Labels and surveys** | QR labels, Compartment surveys, Survey forms | Sticking QR labels on equipment and checking compartments |
| **Maintenance work** | Defects, Repair cases, Work orders, Advisories | Faults and the work to fix them |
| **Planned maintenance** | Due list, Plans, Meters, Calibration, Task templates | Routine maintenance by date or running hours |
| **Parts and stores** | Stock, Transfers, Parts, Stock locations | Spare parts and stock movements |
| **Synchronization** | Sync status, Installations, Conflicts, Files (USB) | Exchanging data with the hub |
| **Operations** | System health, Backups, Data checks | Looking after the installation |
| **Excel** | Excel import / export | Loading or exporting lists in bulk |

---

## 4. Setting up a new installation (administrators)

Do these once, in this order, before people start entering work. Most of the fleet lists are kept at the hub, so on a ship installation many of these steps are already done.

1. **Organization > Fleet, Commands, Ships**: the fleet structure (hub only).
2. **Organization > Departments, Workshops, External providers**.
3. **Organization > Locations**: decks, compartments and spaces for each ship or workshop.
4. **Assets > Classifications**: the kinds of equipment (for example *Diesel generator*).
5. **Assets > Positions**: each ship's functional tree (system, equipment group, equipment, component).
6. **Assets > Asset register**: the physical equipment, installed into positions.
7. **Parts and stores > Parts** and **Stock locations**, then receive the opening stock.
8. **Planned maintenance > Task templates**, **Meters** and **Plans**.
9. **Identity & authority > Roles**, **Users** and **Role assignments**.

Steps 3, 6 and 7 can be done in bulk from a spreadsheet: see [section 13](#13-excel-import-and-export).

---

## 5. Reports

### Overview

The first screen after signing in. It counts what needs attention:

- **Open work orders**, **Past requested date** and **Urgent**
- **Waiting for a decision**: work orders and approvals that need someone to decide
- **Maintenance overdue** and **Maintenance due soon**
- **Stock below minimum**
- **Recurring faults**: the same equipment failing again and again
- **Sync conflicts** and **Installations out of date**

Below the counts, **Open work by ship** shows the open, past-date and high-or-urgent work orders for each ship. *Data as of …* tells you when the figures were worked out.

### Reports

Choose a report, set the filters (**Ship**, **Older than (days)**, **Type**, **Priority**, **Source**) and read the result. **Download CSV** saves it for Excel.

| Report | Shows |
|---|---|
| **Maintenance backlog** | Open work orders, oldest first |
| **Pending reviews and confirmations** | Work and approvals waiting for a decision |
| **Planned maintenance and calibration due** | Plans and calibrations that are due or overdue |
| **Stock below minimum** | Parts whose available stock is under the minimum |
| **Recurring faults** | Equipment with repeated defects |
| **Synchronization health** | When each installation last synchronized |

### Notifications

Warnings raised by the system, for example overdue maintenance or low stock. **Check now** looks again straight away. **Acknowledge** marks one as seen. A notification is **Cleared** by itself once the problem is put right.

---

## 6. Organization

These lists describe the fleet. Each screen has a **New …** button, and **Edit** and **Remove** on every row.

- **Fleet**, **Commands**: the top of the structure.
- **Ships**: each ship's **Code**, **Name**, **Pennant / hull no.**, **Class**, **Type** and **Status** (*Active*, *Inactive*, *Laid up*, *Decommissioned*). Tick **Has its own installation (works offline)** for a ship that will run its own copy.
- **Departments**: belong to a ship.
- **Workshops**: **Kind** is *Onboard* (belongs to a ship), *Command* (belongs to a command) or *Specialist* (supports ships of any command).
- **External providers**: outside repair firms, with contact details.

Codes may use letters, digits and `- _ .`, and are stored in capitals.

### Moving a ship to another command

On **Ships**, choose **Assign command…** on the ship's row. Pick the new **Command** and the **Effective from** time. The old attachment ends at that moment and the new one begins. The ship's records stay with the ship; only the attachment changes. **Command history** lists every attachment, and **Correct** fixes a wrong entry.

### Locations

Choose a ship or workshop on the left to see its locations as a tree. **New location** adds one at the top; **Add inside** adds one inside the selected location. **Kind** can be *Deck*, *Compartment*, *Space*, *Room*, *Tank*, *Area*, *Yard* or *Other*.

A ship installation can change only its own ship's locations; other ships' locations are read-only.

---

## 7. Assets

### Positions: the ship's functional tree

A **position** is a place in the ship where equipment is fitted, for example *Main engine room > Generator No. 1*. Choose a ship to see its tree. **New position** adds a top-level entry and **Add child** adds one below.

Each position has a **Level** (*System*, *Equipment group*, *Equipment* or *Component*) and an optional **Position tag**, the number shown on the ship's drawings (for example `2.1.3`).

**Responsibility** on a position records who looks after it (a department, workshop and so on) and from when. Use **Hand over** to pass it to someone else; the history is kept.

### Asset register: the physical equipment

An **asset** is a real item with a serial number. The position is where it goes; the asset is what is in it. When an item is replaced, the position stays and a different asset is installed.

**To register an asset:**

1. Choose **Register asset**.
2. Fill in **Name**, **Classification**, **Serial number**, **Manufacturer**, **Model** and **Home ship**.
3. Optionally choose a **Position** to install it straight away.
4. Save. The system gives it the next equipment **Tag**, for example `SLN-EQ-00000001`.

Use the search box (tag, name, serial) and the ship and status filters to find assets. Open an asset to see its **Movement history** and record a movement:

| Movement | Use it when |
|---|---|
| **Install** | The asset is fitted into a position |
| **Remove** | It is taken out of its position |
| **Transfer custody** | Someone else now holds it (a ship, department, workshop or external provider) |
| **Change status** | It becomes *In service*, *In store*, *Under repair*, *Out of service* or *Condemned* |
| **Void** | A movement was entered by mistake (a reason is required) |

An asset must be removed before another one can be installed in the same position. Movements must be entered in time order; to fix an old one, void the later movements first.

If the screen says *"Only … equipment tag numbers remain on this installation"*, ask the hub for another range before you run out.

### Classifications

The kinds of equipment, optionally inside a **Parent class**. The parent cannot be changed later. Advisories (see [section 9](#9-maintenance-work)) are attached to classifications.

The fleet uses a standard list based on the Ship Work Breakdown Structure (SWBS). Codes such as `SWBS-324-MSB` (*Main switchboard*) are equipment classes, and codes such as `CMP-EL-ACB` (*Air circuit breaker*) are component classes. Choose the most specific class that fits. Classes marked *Navy extension* in the description cover modern equipment, for example lithium-ion energy storage or DC switchboards.

An *inactive* class is an old code that has been replaced by a standard class. Records that still use it remain valid, but use the standard class for new records.

### Legacy mapping

Hub only. Each row says which standard class replaces an old code: **Exact** or **Standard is broader** moves the equipment automatically; **Legacy is split** means a person chooses for each item. The administrator runs the move ship by ship; see CLASSIFICATION_MERGE.md. When you import equipment from Excel, mapped old codes are translated to the standard class.

---

## 8. Labels and surveys

### QR labels

Each label carries a QR code with its label number. You stick it on the equipment so it can be scanned later.

1. **Issue labels**: say **How many** (up to 200 at a time) and, optionally, which **Ship**. They are *Reserved* until used.
2. Tick the labels you want and choose **Print … selected**. Check the preview, then print at 100% scale on A4 label sheets.
3. Stick a label on the equipment, then choose **Assign** on that label and give the asset's **Equipment tag**. The label becomes *Assigned*.

**Void** a label that is damaged or lost (a reason is required). A voided label number is never reused.

### Survey forms

A survey form is the list of questions asked about each item found during a survey. Enter one question per line as `key | question | type`, where the type is `yesno`, `text` or `number`. For example:

```
oil_level | Is the oil level correct? | yesno
hours | Running hours shown | number
```

### Compartment surveys

A walk through a compartment, recording every item found.

1. **Start survey**: choose the **Compartment** and the **Survey form**.
2. For each item:
   - **Add scanned item**: scan its QR label or type its label number or equipment tag, then record the **Observed condition** and answer the questions.
   - **Add unregistered item**: for equipment that has no tag yet, describe it (manufacturer, model, serial number).
3. Later, choose **Register as asset** on an unregistered item to add it to the asset register. You can pick a reserved **Label to stick on it**.
4. **Close survey** when done. A closed survey cannot be changed.

The survey header shows how many items were scanned, are pending and have been registered.

---

## 9. Maintenance work

Work usually flows like this:

**Defect** → **Repair case** → one or more **Work orders** → job cards, labour, findings and tests → **approval** → **repair accepted** → **closed**

You can also raise a work order directly, without a defect or repair case.

### Defects

Anyone who finds a fault reports it here.

1. Choose **Report defect**.
2. Enter a **Title** and **Description** and choose the **Severity** (*Minor*, *Major*, *Critical*).
3. Choose the **Ship**, or give the **Equipment tag** instead (the ship is then taken from the equipment).
4. Save. The defect gets a number and its status is *Open*.

Then, on the defect's row:

- **Make repair case** to start the repair. The defect's status becomes *In a repair case*.
- **Dismiss** if no work is needed (a reason is required).

### Repair cases

A repair case groups the work orders for one repair. Open a case to see its work orders and to add a **New work order** to it. A case is started, held, resumed, completed, closed and reopened with the buttons at the top of the case. A case with work orders cannot be removed: close it instead.

### Work orders

Choose **New work order** (or add one from a repair case) and fill in:

- **Title** and **Description**
- **Ship**, or an **Equipment tag**
- **Type of work**: *Corrective*, *Preventive*, *Inspection* or *Modification*
- **Priority**: *Low*, *Normal*, *High* or *Urgent*
- **Executing party** (optional): who does the work, such as a department, workshop or external provider
- **Requested by**: the date the work is wanted by

Filter the list by ship, progress and closure, or search by number or title. Open a work order to work on it.

#### The four status lines

A work order's status is shown on four separate lines, because they are decided by different people:

| Line | Values | Who moves it |
|---|---|---|
| **Progress** | *Planned* → *In progress* ⇄ *On hold* → *Work complete* | The people doing the work |
| **Approval** | *No approval needed*, *Review pending*, *Approved*, *Rejected* | The approving authority |
| **Return to service** | *Not assessed*, *Restricted*, *Cleared*, *Withheld* | Whoever accepts the repair |
| **Closure** | *Open*, *Closed*, *Reopened* | The person closing the order |

The screen offers only the buttons that make sense at that moment:

| Button | Available when |
|---|---|
| **Start work** | Progress is *Planned* |
| **Put on hold** / **Work complete** | Progress is *In progress* |
| **Resume** | Progress is *On hold* |
| **Back to rework** / **Accept repair** / **Close** | Progress is *Work complete* |
| **Request review** | No review is pending |
| **Approve or reject** | Approval is *Review pending* |
| **Reopen** | The order is *Closed* |

#### Approvals

Your administrator decides which work needs approval (**Identity & authority > Approval gates**). For a gate set to *Approval required before work*, **Start work** is refused until the order is approved. With *Work may proceed, review pending*, work can start and the approval follows.

1. Choose **Request review**. Approval becomes *Review pending* and the order appears under **Waiting for a decision** on the Overview.
2. The approver opens the order, chooses **Approve or reject** and records the **Decision**. **Remarks** are required when rejecting.

If an approval is rejected, request a new review before starting the work again.

#### Recording the work

Inside an open work order:

- **Job cards**: the individual tasks, each with **Instructions** and a **Checklist** (one step per line). A job card goes *Draft* → **Issue** → **Complete**. Only a draft can be removed; **Void** an issued one instead.
- **Labour**: who worked (**Worker**, **Trade**) and for how many **Minutes**. The total is shown as hours.
- **Findings**: an *Observation*, *Cause*, *Recommendation* or *Additional defect* found during the work.
- **Tests**: the **Test** name, **Result** (*Pass*, *Fail*, *Not applicable*) and **Measured value**.
- **Status history**: every status change, who made it and when.

Leave **When** empty to mean "now". Fill it in when you are entering work done earlier.

#### Accepting the repair and closing

1. When the work is finished, choose **Work complete**.
2. Choose **Accept repair**. Choose **Accept the repair** or **Reject the repair** and set **Return to service**: *Cleared*, or *Restricted* with the **Restrictions** written down.
3. Choose **Close**.

An order cannot be closed until the work is complete and the repair acceptance is recorded. If return to service is *Withheld*, send it **Back to rework** or accept the repair first.

A closed order can be **Reopened** if the fault comes back.

#### Handing work to another party

**Offer to another party** proposes that someone else (another ship, a workshop, an external provider) carries out the work. The order shows *hand-over offered* until the other side chooses **Accept hand-over** or **Decline**. You can **Withdraw offer** while it is waiting. Only one offer can wait at a time.

### Advisories

Technical advice attached to a **Classification**, with a **Severity** of *Information*, *Caution* or *Warning*. The advice is shown on all equipment of that classification.

---

## 10. Planned maintenance

### Task templates

A reusable description of a routine job: **Title**, **Description**, **Checklist** (one step per line), **Estimated minutes** and **Priority**. A template in use by plans cannot be removed: mark it inactive.

### Meters

Running-hour meters and counters on equipment. Choose **New meter**, give the **Equipment tag**, a **Name** (for example *Running hours*), the **Kind** (*Running hours* or *Counter*) and the **Unit**.

- **Record reading**: what the meter shows now. A reading cannot be lower than the previous one.
- **Meter replaced**: when a meter is changed, enter the reading on the new meter. The total carries on from the old one.
- **Readings**: the history.

### Plans

A plan says how often a task is done on a piece of equipment.

1. Choose **New plan**.
2. Give the **Equipment tag**, the **Task template** and a **Title**.
3. Choose the **Basis**:
   - **Calendar**: **Every (days)**, and **Create the work order this many days ahead** (default 7).
   - **Running hours**: the **Meter**, **Every (running hours)**, and **Create the work order this many hours ahead** (default 50). The meter must belong to the same equipment.
4. Save.

**Suspend** pauses a plan (for example while a ship is laid up) and **Resume** restarts it. **Mark done** records that the maintenance was carried out; for a running-hours plan, give the **Hours when done** or leave it empty to use the latest meter total.

### Due list

Everything that is **Overdue**, **Due soon** or **Not yet due**, from plans and calibrations. Choose **Create due work orders** to raise work orders for the items that are due; the list then shows *Work order created*. Those work orders are then handled like any other (see [section 9](#9-maintenance-work)).

### Calibration

**Record calibration** for an instrument: **Result** (*Pass*, *Adjusted*, *Fail*), **Certificate number**, **Calibrated by** and **Next due on**. Calibrations that are coming due appear on the due list.

---

## 11. Parts and stores

### Parts and stock locations

- **Parts** is the catalogue: **Part number**, **Name**, **Unit** (each, m, kg, l, set…), **Category**, **Manufacturer** and **Manufacturer part number**.
- **Stock locations** are the stores, lockers and workshops where parts are kept, each belonging to a ship or workshop (or the fleet/hub store).

A part or location with stock history cannot be removed: mark it inactive.

### Stock

**Stock on hand** shows, for each part and location, the quantity **On hand**, **Reserved** and **Available**, and the **Minimum**. Rows under the minimum are marked *low*; tick **Below minimum only** to see just those.

Every stock change is a transaction that is never edited, so the history always adds up:

| Button | Use it for |
|---|---|
| **Receive stock** | Parts arriving. Give the **Quantity**, optionally **Unit cost** and **Currency** (for example LKR), and a **Reference** such as the purchase order or delivery note. |
| **Issue stock** | Parts taken for use. Give the **Work order number** (for example `SLN-WO-00000001`; it must be open and on the same ship) or, if there is none, what it was **Used for**. |
| **Return stock** | Unused parts coming back. |
| **Adjust stock** | Correcting a count. **Change (+ or −)** adds or removes stock; always say why. |

Quantities can have up to 3 decimal places.

### Transfers

Moving stock from one location to another, for example from the hub store to a ship.

1. **New transfer**: choose **From** and **To**, then add the **Parts** and **Quantity**.
2. **Dispatch**: the stock leaves the source and the transfer is *In transit*.
3. At the destination, **Receive**: the stock arrives and the transfer is *Received*.

**Call back** cancels a transfer in transit and returns the stock to the source (a reason is required).

---

## 12. Synchronization

### Sync status

Shows this installation, what is **Waiting to send**, the **Conflicts to decide** and the **Recent exchanges**. On a ship, choose **Synchronize now** to exchange with the hub; give the **Hub address** the first time, or leave it empty to use the saved one.

After the exchange the screen says what was sent, received, refused and held back. If it warns that *the clock differs from the hub*, have the computer's time corrected.

### Installations (hub)

The list of installations, with their **Status** (*Waiting to join*, *Active*, *Decommissioned*), **Last exchange** and **Ships followed**.

- **Add installation**: give the **Kind**, **Code**, **Name** and the **Ship it serves**. The hub creates a **provisioning package** file. Save it and take it to the new machine; it holds a one-time secret. The person setting up that machine joins with it (see [OPERATIONS.md](OPERATIONS.md), section 4). Delete the file afterwards.
- **Choose ships**: change which ships an installation follows. Adding a ship sends that ship's existing records at the next exchange.
- **Decommission**: the installation can no longer send or receive. Its past changes stay.

### Files (USB): no network link

1. At the hub, **Create a file for an installation** and choose the installation.
2. Carry the file to the ship. On the ship, **Read a file**.
3. On the ship, **Create a file for the hub**, carry it back and **Read a file** at the hub.

Files are signed: a damaged or altered file is refused, and reading the same file twice does nothing. **Emergency: include everything ever written here** is only for when a ship's machine is about to be replaced and its changes must not be lost.

### Conflicts

A conflict means two versions of one record arrived, or a change could not be applied. Open it with **Decide** and choose **Use the incoming version**, **Keep this installation's version** or **Dismiss, nothing to do**, with a reason.

Changes *Sent by a newer version* wait until this installation is upgraded; then choose **Retry held changes**.

---

## 13. Excel import and export

Load locations, assets or parts in bulk from a spreadsheet, or export the current data.

1. Choose what to import under **Data**.
2. **Download template (Excel)** or **(CSV)**. The **Columns** table explains what to enter in each column and which ones are required.
3. Fill in the template in Excel. To change existing records, start from **Export current data** instead, edit it and upload it.
4. Upload the filled-in file (.xlsx or .csv, up to 5 MB).
5. Check the **preview**. It shows how many rows are **To add**, **To change**, **Unchanged** and **With errors**. **Nothing has been saved yet.** Choose **Rows with errors only** to see the problems, or **Download problem report**.
6. Choose **Save … rows**. If some rows have errors, you can **Save the … valid rows and leave out the … with errors**, or **Discard this preview**, fix the file and upload it again.

**Recent imports** lists earlier uploads and whether they were saved.

---

## 14. Operations

- **System health**: the installation, database size, free disk space, last backup, last verified backup and last data check, with a warning for anything that needs attention.
- **Backups**: a backup is made automatically every 24 hours. **Back up now** makes one by hand. **Verify** checks that a backup can really be restored; do this now and then. Restoring is done from the command line with the application stopped: see [OPERATIONS.md](OPERATIONS.md), section 6.
- **Data checks**: **Run data check** looks for records that point to something missing, overlapping number ranges, negative stock and similar problems. It only reports; it never changes data.

---

## 15. Identity & authority (administrators)

### Users

**New user** adds a person with their **Name**, **Rank** and **Service number**. Then use **Sign-in** on their row to set a **Username** (3 to 32 characters: a–z, 0–9, dot, underscore, hyphen) and **Password**. Changing a password does not affect approvals the person made earlier.

### Roles and role assignments

- **Roles**: a named set of permissions, for example *Ship engineer* or *Stores keeper*. **Permissions** on a role's row chooses what it may do; *Everything (\*)* gives full access. The built-in **Administrator** role has full access.
- **Role assignments**: give a user a role, for a **Scope**: *Fleet*, *Command*, *Ship*, *Workshop* or *Department*. The **Scope id** is the id of that command, ship, workshop or department; the assignment applies only there. **Valid from** and **Valid until** limit it in time (leave **Valid until** empty for no end date).

### Approval gates

A gate says whether a kind of decision needs approval. **Gate code** names it; for work orders the codes are `wrk.work_order.approve` (approving the work) and `wrk.acceptance.accept` (accepting the repair). **Approval mode** is one of:

- *Approval required before work*
- *Work may proceed, review pending*
- *No approval*

**When the offline lease has expired** says what happens to approvals on an installation that has not synchronized in time: *Allow*, *Allow, pending confirmation* or *Deny*. Leave it empty to record them as pending confirmation.

### Offline authority

A **lease** lets an installation approve work on its own for a number of days (**Lease (days)**) after its last synchronization with the hub. Leave the scope empty to apply it to every installation.

### Users per installation

Which users may sign in at which installation. Only users provisioned to an installation are sent to it.

### Pending confirmation

Approvals made while the offline lease had expired, or by someone whose authority had been withdrawn. Someone with the right authority reviews each one and chooses **Confirm**. The confirmation is recorded as a new approval under their name; the original is never changed.

### Revocations

**Withdraw or restore authority** takes away (or gives back) a user's authority from a given time. Leave **Assignment id** empty to withdraw all of it. Approvals the person decided at or after that time are sent to **Pending confirmation**.

---

## 16. Common messages

| Message | What to do |
|---|---|
| *Please check the entry* | A field is missing or wrong; the form marks which one. |
| *Not permitted* | Your role does not allow this. Ask your administrator. |
| *Changed by someone else* | See [When someone else changed the record](#when-someone-else-changed-the-record). |
| *Held by another installation* | The record belongs to another ship or the hub. Change it there. |
| *Number range used up* | This installation has no tag, label, work or transfer numbers left. Ask the hub for another range. |
| *Not allowed right now* | The step does not fit the record's current state, for example closing an order before the work is complete. The message says what to do first. |
| *Related record missing* | Something this record points to has not arrived yet. Synchronize. |
| *Authority expired* | Synchronize with headquarters. |
| *Server unreachable* | The CMMS program is not running or the network is down. Tell whoever looks after the installation. |

---

## 17. Words used

| Word | Meaning |
|---|---|
| **Installation** | One copy of the program with its own database: the hub, a ship, a workshop or a command. |
| **Hub** | The installation at headquarters. Keeps fleet-wide lists and number ranges, and passes changes between ships. |
| **Synchronize** | Exchange changes with the hub, over the network or by file. |
| **Scope** | The command, ship, workshop or department a record or permission belongs to. |
| **Position** | A place in a ship's functional tree where equipment is fitted. |
| **Asset** | A physical item with a serial number, installed in a position. |
| **Equipment tag** | The permanent number of an asset, for example `SLN-EQ-00000001`. |
| **Position tag** | The number of a position on the ship's drawings, for example `2.1.3`. Not the same as the equipment tag. |
| **Defect** | A fault that someone has reported. |
| **Repair case** | The repair of one or more defects, holding the work orders for it. |
| **Work order** | A piece of work to be done, with job cards, labour, findings and tests. |
| **Job card** | One task within a work order. |
| **Return to service** | The decision that repaired equipment may be used again, fully or with restrictions. |
| **Gate** | A decision that may need approval before or after work. |
| **Lease** | How long an installation may approve on its own without synchronizing. |
| **Void** | Cancel an entry made by mistake. It stays in the history, marked as voided. |
