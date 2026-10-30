# File Tracker

A single HTML page for looking up procurement files from the monthly
"File Update" Excel and sending a file's details to the responsible
department on WhatsApp.

- Search by item name, file no, order no, supplier, GORF / PR / RL no or
  present position, and filter by sheet, status, office and supplier.
- **WhatsApp** on a file opens WhatsApp with the file's details filled in:
  item(s), file no, GORF, PR, RL, order no, supplier, value, present
  position and remarks. Tick several files to send them in one message.
- **Departments**: save each department's WhatsApp number and the office
  code(s) from the file number (`ENA/APO`, `NHQ/SSOLPCA`, …). When you
  share a file held by that office, its department is picked for you.
  Numbers are kept on that device only.
- **Load Excel** reads a newer File Update .xlsx straight in the page. The
  file stays on the device and needs no internet.

## Building a page with the data inside

```
node tools/file-tracker/build.mjs "01. File Update - 2026 September.xlsx" "File Tracker.html"
```

This writes one self-contained .html file (no internet needed) that can be
sent by WhatsApp or email and opened on any phone or PC. Run it without an
.xlsx to get an empty page that only uses **Load Excel**.

## How the sheets are read

`parser.js` finds each sheet's header row (the row with ITEM / Description),
then reads it row by row:

- A row with an S/N, or reference numbers that differ from the current
  file, starts a new file. Rows under it with no S/N are that file's items.
- Reference numbers are recognised by their form wherever they sit:
  `…GORF…`/`…RJRF…` is GORF, `/RL/` is RL, `/FO/`, `/RFO/`, `/RCFO/` is the
  file no, `/PO/`, `/RCPO/`, `/FPO/`, `DPC/…`, `MTR/…` is the order no, and
  `/PR/`, `/PRF/`, `/RCPR/` is the PR no.
- The supplier comes from the present position text ("… From ACE MOTORS",
  "SAMWOOTEK ENGINEERING PVT LTD 25/08/2026 …").
- The status (PO created, Tender / TEC, Received, …) comes from the
  present position wording.
- Sheets named `Sheet1`, `Sheet2`, `Sheet3 (2)` … are working sheets and
  are skipped.
