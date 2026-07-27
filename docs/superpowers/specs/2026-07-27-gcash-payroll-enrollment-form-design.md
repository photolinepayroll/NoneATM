# GCash Payroll Enrollment Form — Design Spec

Date: 2026-07-27
Client: Photoline Enterprises Corporation

## Purpose

A mobile-friendly form for employees without an ATM Savings Account to enroll
their own Verified GCash Account for salary crediting. Responses, uploaded
GCash screenshots, and handwritten signatures must be saved automatically to
Google Sheets / Google Drive.

## Architecture

A single Google Apps Script project bound to a Google Sheet, deployed as a
Web App (HTML Service). A plain Google Form cannot provide a signature pad or
custom file-linking behavior, so this is built as a custom form instead of a
native Google Form.

Files:
- `Code.gs` — server-side logic:
  - `setup()` — one-time function; creates the Sheet
    ("Photoline GCash Payroll Enrollment Responses") and Drive folder
    ("GCash Payroll Enrollment Attachments") if they don't already exist.
  - `doGet(e)` — serves `Index.html` as the web app page.
  - `submitForm(formData)` — called from the client via `google.script.run`.
    Re-validates everything server-side, saves the screenshot and signature
    PNG into the Drive folder, appends a row to the Sheet, returns
    success/failure to the client.
- `Index.html` — the form UI (single scrolling page, mobile-first).
- `Styles.html` — CSS, included via Apps Script HTML templating
  (`<?!= HtmlService.createHtmlOutputFromFile('Styles').getContent(); ?>`).
- A signature-pad `<canvas>` and its JS live inline in `Index.html` (small
  enough not to warrant a separate file); exported to a PNG data URL on
  submit.
- `logo.png` — Photoline + GCash combined logo, embedded in the page header
  as a base64 data URI (avoids an extra Drive/network fetch on load).

## Data Model

### Google Sheet: "Photoline GCash Payroll Enrollment Responses"

One tab, header row, one row per submission, exactly these columns (no
extra columns):

| Column | Source |
|---|---|
| Timestamp | Recorded server-side in `submitForm`, not from the client's clock |
| Employee Name | form field |
| Branch/Department | form field |
| Contact Number | form field |
| Verified GCash Mobile Number | form field |
| Declaration Accepted | "Yes" — row is only ever written if the checkbox was true (re-checked server-side) |
| GCash Screenshot Link | Drive file view URL |
| Signature Link | Drive file view URL |

### Google Drive folder: "GCash Payroll Enrollment Attachments"

Flat folder. Both files from one submission are named with a shared
timestamp+name prefix so they sort adjacently and don't collide across
employees with the same name, e.g.:

- `2026-07-27_1432_JuanDelaCruz_GCashScreenshot.jpg`
- `2026-07-27_1432_JuanDelaCruz_Signature.png`

Folder is NOT shared as "anyone with the link" — access stays restricted to
whoever already has access to the underlying Drive/Sheet, so screenshots and
signatures aren't publicly exposed.

## Validation (enforced server-side, not just in the browser)

- Employee Name, Branch/Department, Contact Number, Verified GCash Mobile
  Number: all required, non-empty.
- Screenshot file: type must be jpg/jpeg/png/pdf, size ≤ 10MB. Client also
  checks this immediately on file selection (before any upload) so the
  employee doesn't wait on a slow mobile connection just to get rejected —
  but the server re-checks regardless of what the client reports.
- Declaration checkbox: must be true.
- Signature: canvas must not be blank/untouched.

If server-side validation fails, no row is written and no files are saved to
Drive — the client shows the validation error and lets the employee correct
it without re-filling the rest of the form.

## Frontend UX

Single scrolling page (all 5 sections stacked), matching the field order and
exact wording specified in the requirements:

1. Header: logo + "GCash Payroll Enrollment Form" title + purpose line.
2. Section 1 – Employee Information: 4 required text inputs, inline error
   text on blur if left empty.
3. Section 2 – GCash Verification: file picker restricted to
   `.jpg,.jpeg,.png,.pdf`, with the required-screenshot-content reminder
   text (Full Name, Verified Status, GCash Mobile Number) and the 10MB/file
   type limits shown to the user.
4. Section 3 – Declaration: exact required checkbox text from the spec;
   submit stays disabled until checked.
5. Section 4 – Signature: touch-drawable canvas sized to the phone's width;
   one "Clear" button that wipes the canvas (re-signing is just drawing
   again after Clear).
6. Section 5: no visible field; timestamp is recorded automatically
   server-side after a successful submit.
7. Submit button: disabled + spinner while the upload is in flight (files
   can be a few MB on a mobile connection). On success, the form content is
   replaced with the exact confirmation message from the spec. On failure
   (e.g. quota error, dropped connection), an inline error is shown and the
   employee can retry submit without losing what they already filled in or
   re-drawing the signature.

## Deployment (manual steps, handed to the user — no direct API access to
their Google account is used)

1. Create/open a Google Sheet, Extensions → Apps Script.
2. Paste in `Code.gs`, `Index.html`, `Styles.html`; add `logo.png` as base64
   inside `Index.html` (Apps Script HTML Service has no binary asset host,
   so the logo is inlined as a data URI).
3. Run `setup()` once from the Apps Script editor to create/locate the Sheet
   tab and the Drive folder, and to grant the script the Drive/Sheets
   permissions it needs.
4. Deploy → New deployment → Web app. Execute as "Me"; access level (org-only
   vs "Anyone with the link") to be decided with the user at deployment time
   depending on whether all employees are inside the company's Workspace
   domain.
5. Share the resulting web app URL with employees.

## Out of scope

- No email notifications on submission (not requested).
- No admin/HR review dashboard beyond the raw Sheet (not requested).
- No edit/resubmit flow for already-submitted responses (not requested).
