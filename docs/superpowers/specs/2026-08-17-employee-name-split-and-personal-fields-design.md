# Employee Name Split + Birthday/City-Province Fields — Design

**Date:** 2026-08-17
**Status:** Approved

## Purpose

The public enrollment form (`index.html`) currently collects a single free-text
"Employee Name" field. This adds structure and two new pieces of employee
information:

- Split "Employee Name" into **First Name**, **Middle Name**, **Last Name**.
- Add **Birthday** (date).
- Add **City/Province** (single text field).

## Scope

Public form (`index.html`), backend (`apps-script/Code.gs`, including the
live Google Sheet schema), and admin dashboard (`admin.html`). The legacy
`apps-script/Index.html` / `apps-script/Admin.html` surfaces are out of
scope per `CLAUDE.md` (not kept in sync).

## Form changes (`index.html`)

Section 1 – Employee Information becomes:

1. First Name — required
2. Middle Name — optional (not everyone has one)
3. Last Name — required
4. Birthday — `<input type="date">`, required
5. City/Province — single text field, required
6. Branch/Department — required (unchanged)
7. Contact Number — required (unchanged)
8. Verified GCash Mobile Number — required (unchanged)

Each new field follows the existing pattern already used by every other
field: labeled input, inline `<span class="error">`, a row on the
review-before-submit screen, and a blank-check in the client-side validator
(no check for Middle Name, since it's optional).

The payload sent to the backend replaces the single `employeeName` string
with `firstName`, `middleName`, `lastName`, `birthday` (ISO `yyyy-mm-dd`
from the date input), and `cityProvince`.

## Backend & Sheet schema (`apps-script/Code.gs`)

### Column layout

New columns are inserted **immediately after "Employee Name"**, matching
the form's field order. Everything from "Branch/Department" onward shifts
right by 5 columns.

| # | Column | Notes |
|---|--------|-------|
| 1 | Timestamp | unchanged |
| 2 | Employee Name | **kept** — auto-populated by the backend as `firstName + ' ' + (middleName ? middleName + ' ' : '') + lastName` on every new submission, so anything already reading this column (search, CSV, printed record, screenshot/signature filenames) keeps working unchanged for both old and new rows |
| 3 | First Name | new |
| 4 | Middle Name | new |
| 5 | Last Name | new |
| 6 | Birthday | new |
| 7 | City/Province | new |
| 8 | Branch/Department | was column 3 |
| 9 | Contact Number | was column 4 |
| 10 | Verified GCash Mobile Number | was column 5 |
| 11 | Declaration Accepted | was column 6 |
| 12 | GCash Screenshot Link | was column 7 |
| 13 | Signature Link | was column 8 |

`SHEET_HEADERS` is updated to this 13-entry array, in this order.

### Required one-time manual Sheet migration

The live Sheet already holds real submissions in the **old** 8-column
layout, with Branch/Department through Signature Link physically sitting
in columns C–H. Deploying new code that expects data at the new column
positions is not sufficient on its own — the existing rows' actual values
need to physically move to columns H–M first, or every historical row will
display wrong data under the new headers (e.g., "First Name" showing an
old Branch/Department value).

**Before the new code is deployed**, someone with edit access to the Sheet
must: select columns C–H → right-click → "Insert 5 columns left" (or the
Sheets-UI equivalent), so existing data shifts right and 5 blank columns
land in C–G. This is a manual step — Claude Code has no Sheets access to
perform it. It must be done once, coordinated with the code deploy (ideally
immediately before, since `getOrCreateSheet_` will otherwise overwrite the
header row to the new 13-header set on the next write while the data is
still in old positions).

### Code changes

- `validateSubmission_`: add `firstName`, `lastName`, `birthday`,
  `cityProvince` to the required-fields check (Middle Name excluded).
  Birthday validated as a parseable date; no age/range constraint.
- `submitForm`: builds the combined `Employee Name` cell value from the
  three name parts; `namePart` (used for screenshot/signature filenames)
  is built from `firstName` + `lastName` instead of the old single field;
  `appendRow` writes all 13 columns in the new order.
- `listSubmissions`, `getSubmissionsFields`: add `firstName`, `middleName`,
  `lastName`, `birthday`, `cityProvince` to the returned object, alongside
  the still-populated `employeeName`. All `row[n]` indices affected by the
  column shift (Branch/Department through Signature Link) are updated to
  their new positions.
- `getSubmissionsMedia`: `extractFileId_` calls move from `row[6]`/`row[7]`
  to `row[11]`/`row[12]` (Screenshot Link / Signature Link's new indices).
- `getSubmissionDetail` (legacy, only reachable via `google.script.run` from
  the unmaintained `apps-script/Admin.html`): left as functionally
  equivalent, with its `row[n]` indices updated to match the new column
  positions so it doesn't silently read the wrong columns, but no new
  fields are added to its return value (not worth touching a surface that
  isn't kept in sync).

## Admin dashboard (`admin.html`)

- Detail view and printed record: add "Birthday" and "City/Province" rows
  near the existing "Employee Name" row.
- Table/list view: unchanged (Name/Branch/Contact/GCash Number columns) —
  new fields are visible in the detail view and print, not the summary
  table, to avoid cramming it.
- CSV export: add First Name, Middle Name, Last Name, Birthday, and
  City/Province as additional columns.
- Search: unchanged — still matches against the combined Employee Name.

## Out of scope

- `apps-script/Index.html` / `apps-script/Admin.html` (legacy, not kept in
  sync per `CLAUDE.md`).
- Adding the new fields as summary-table columns in the admin dashboard.
- Age/date-range validation on Birthday.
- `PROMPT.tx.txt` is a historical record of the original spec and is not
  updated.
