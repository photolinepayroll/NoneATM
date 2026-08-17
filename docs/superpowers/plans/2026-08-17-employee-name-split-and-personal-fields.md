# Employee Name Split + Birthday/City-Province Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the public enrollment form's single "Employee Name" field into First/Middle/Last Name, add Birthday and City/Province fields, and thread them through the backend Sheet schema and the admin dashboard.

**Architecture:** The Sheet gains 5 new columns inserted immediately after the existing "Employee Name" column (which is kept and auto-populated from the three name parts for backward compatibility), shifting Branch/Department onward right by 5. `apps-script/Code.gs`, `index.html`, and `admin.html` are each updated to match. No build step, no test framework — validation is `node --check` on extracted `<script>` blocks (per `CLAUDE.md`) plus manual browser verification.

**Tech Stack:** Vanilla HTML/CSS/JS (`index.html`, `admin.html`), Google Apps Script (`apps-script/Code.gs`), Google Sheets as the datastore.

**Reference spec:** `docs/superpowers/specs/2026-08-17-employee-name-split-and-personal-fields-design.md`

---

## File Structure

| File | Responsibility in this change |
|---|---|
| `apps-script/Code.gs` | Sheet schema (`SHEET_HEADERS`), submission validation, write path (`submitForm`), and every admin read path (`listSubmissions`, `getSubmissionsFields`, `getSubmissionsMedia`, `getSubmissionDetail`) |
| `index.html` | Public form fields, client-side validation, review screen, submission payload |
| `admin.html` | Detail view, printed record card, CSV export |

No new files are created. All edits are to these three existing files.

---

### Task 1: Sheet schema and submission validation (`Code.gs`)

**Files:**
- Modify: `apps-script/Code.gs:3-12` (`SHEET_HEADERS`)
- Modify: `apps-script/Code.gs:175-181` (`validateSubmission_`)

- [ ] **Step 1: Update `SHEET_HEADERS` to insert the 5 new columns after "Employee Name"**

Replace:

```js
const SHEET_HEADERS = [
  'Timestamp',
  'Employee Name',
  'Branch/Department',
  'Contact Number',
  'Verified GCash Mobile Number',
  'Declaration Accepted',
  'GCash Screenshot Link',
  'Signature Link'
];
```

with:

```js
const SHEET_HEADERS = [
  'Timestamp',
  'Employee Name',
  'First Name',
  'Middle Name',
  'Last Name',
  'Birthday',
  'City/Province',
  'Branch/Department',
  'Contact Number',
  'Verified GCash Mobile Number',
  'Declaration Accepted',
  'GCash Screenshot Link',
  'Signature Link'
];
```

- [ ] **Step 2: Add the new required fields and a birthday format check to `validateSubmission_`**

Replace:

```js
function validateSubmission_(formData) {
  var errors = [];
  ['employeeName', 'branchDepartment', 'contactNumber', 'gcashMobileNumber'].forEach(function (field) {
    if (!formData[field] || String(formData[field]).trim() === '') {
      errors.push(field + ' is required.');
    }
  });
```

with:

```js
function validateSubmission_(formData) {
  var errors = [];
  ['firstName', 'lastName', 'birthday', 'cityProvince', 'branchDepartment', 'contactNumber', 'gcashMobileNumber'].forEach(function (field) {
    if (!formData[field] || String(formData[field]).trim() === '') {
      errors.push(field + ' is required.');
    }
  });

  if (formData.birthday && isNaN(new Date(formData.birthday).getTime())) {
    errors.push('birthday must be a valid date.');
  }
```

(Middle Name is intentionally left out of the required-fields list — it's optional.)

- [ ] **Step 3: Syntax-check**

Run:

```bash
cp apps-script/Code.gs /tmp/code-check.js && node --check /tmp/code-check.js && echo OK
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps-script/Code.gs
git commit -m "Add First/Middle/Last Name, Birthday, City/Province to Sheet schema and validation"
```

---

### Task 2: `submitForm` write path (`Code.gs`)

**Files:**
- Modify: `apps-script/Code.gs:132-163`

- [ ] **Step 1: Build the combined name from the three parts, and write all 13 columns in the new order**

Replace:

```js
  var now = new Date();
  var namePart = String(formData.employeeName).replace(/[^a-zA-Z0-9]/g, '');
  var stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
```

with:

```js
  var now = new Date();
  var fullName = String(formData.firstName) + ' ' + (formData.middleName ? String(formData.middleName) + ' ' : '') + String(formData.lastName);
  var namePart = fullName.replace(/[^a-zA-Z0-9]/g, '');
  var stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
```

Replace:

```js
    sheet.appendRow([
      now,
      sanitizeForSheet_(formData.employeeName),
      sanitizeForSheet_(formData.branchDepartment),
      sanitizeMobileForSheet_(formData.contactNumber),
      sanitizeMobileForSheet_(formData.gcashMobileNumber),
      'Yes',
      screenshotFile.getUrl(),
      signatureFile.getUrl()
    ]);
```

with:

```js
    sheet.appendRow([
      now,
      sanitizeForSheet_(fullName),
      sanitizeForSheet_(formData.firstName),
      sanitizeForSheet_(formData.middleName || ''),
      sanitizeForSheet_(formData.lastName),
      sanitizeForSheet_(formData.birthday),
      sanitizeForSheet_(formData.cityProvince),
      sanitizeForSheet_(formData.branchDepartment),
      sanitizeMobileForSheet_(formData.contactNumber),
      sanitizeMobileForSheet_(formData.gcashMobileNumber),
      'Yes',
      screenshotFile.getUrl(),
      signatureFile.getUrl()
    ]);
```

- [ ] **Step 2: Syntax-check**

```bash
cp apps-script/Code.gs /tmp/code-check.js && node --check /tmp/code-check.js && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps-script/Code.gs
git commit -m "Write First/Middle/Last Name, Birthday, City/Province to the Sheet on submit"
```

---

### Task 3: Admin read paths (`Code.gs`)

The column shift (Branch/Department through Signature Link move 5 positions right) touches every function that reads a row by index. New 0-based column positions: `0` Timestamp, `1` Employee Name, `2` First Name, `3` Middle Name, `4` Last Name, `5` Birthday, `6` City/Province, `7` Branch/Department, `8` Contact Number, `9` GCash Mobile Number, `10` Declaration Accepted, `11` Screenshot Link, `12` Signature Link.

**Files:**
- Modify: `apps-script/Code.gs:264-278` (`listSubmissions`)
- Modify: `apps-script/Code.gs:325-345` (`getSubmissionDetail`)
- Modify: `apps-script/Code.gs:347-361` (`getSubmissionsFields`)
- Modify: `apps-script/Code.gs:373-376` (`getSubmissionsMedia`)

- [ ] **Step 1: Update `listSubmissions`' row mapping**

Replace:

```js
      result.push({
        rowIndex: i + 2,
        timestamp: Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
        timestampIso: Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
        employeeName: data[i][1],
        branchDepartment: data[i][2],
        contactNumber: normalizeMobileNumber_(data[i][3]),
        gcashMobileNumber: normalizeMobileNumber_(data[i][4])
      });
```

with:

```js
      result.push({
        rowIndex: i + 2,
        timestamp: Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
        timestampIso: Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
        employeeName: data[i][1],
        firstName: data[i][2],
        middleName: data[i][3],
        lastName: data[i][4],
        birthday: data[i][5],
        cityProvince: data[i][6],
        branchDepartment: data[i][7],
        contactNumber: normalizeMobileNumber_(data[i][8]),
        gcashMobileNumber: normalizeMobileNumber_(data[i][9])
      });
```

- [ ] **Step 2: Update `getSubmissionDetail`'s column indices (legacy function — indices only, no new fields)**

Replace:

```js
function getSubmissionDetail(passcode, rowIndex) {
  requireAdmin_(passcode);
  var sheet = getSheet_();
  var row = sheet.getRange(rowIndex, 1, 1, SHEET_HEADERS.length).getValues()[0];

  var blobs = fetchFilesParallel_([extractFileId_(row[6]), extractFileId_(row[7])]);
  var screenshotBlob = blobs[0];
  var signatureBlob = blobs[1];

  return {
    timestamp: Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'MMMM d, yyyy h:mm a'),
    employeeName: row[1],
    branchDepartment: row[2],
    contactNumber: normalizeMobileNumber_(row[3]),
    gcashMobileNumber: normalizeMobileNumber_(row[4]),
    declarationAccepted: row[5],
    screenshotBase64: screenshotBlob ? Utilities.base64Encode(screenshotBlob.getBytes()) : null,
    screenshotMimeType: screenshotBlob ? screenshotBlob.getContentType() : null,
    signatureBase64: signatureBlob ? Utilities.base64Encode(signatureBlob.getBytes()) : null
  };
}
```

with:

```js
function getSubmissionDetail(passcode, rowIndex) {
  requireAdmin_(passcode);
  var sheet = getSheet_();
  var row = sheet.getRange(rowIndex, 1, 1, SHEET_HEADERS.length).getValues()[0];

  var blobs = fetchFilesParallel_([extractFileId_(row[11]), extractFileId_(row[12])]);
  var screenshotBlob = blobs[0];
  var signatureBlob = blobs[1];

  return {
    timestamp: Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'MMMM d, yyyy h:mm a'),
    employeeName: row[1],
    branchDepartment: row[7],
    contactNumber: normalizeMobileNumber_(row[8]),
    gcashMobileNumber: normalizeMobileNumber_(row[9]),
    declarationAccepted: row[10],
    screenshotBase64: screenshotBlob ? Utilities.base64Encode(screenshotBlob.getBytes()) : null,
    screenshotMimeType: screenshotBlob ? screenshotBlob.getContentType() : null,
    signatureBase64: signatureBlob ? Utilities.base64Encode(signatureBlob.getBytes()) : null
  };
}
```

- [ ] **Step 3: Update `getSubmissionsFields` — new indices plus the 5 new returned fields**

Replace:

```js
function getSubmissionsFields(passcode, rowIndexes) {
  requireAdmin_(passcode);
  var sheet = getSheet_();
  return rowIndexes.map(function (rowIndex) {
    var row = sheet.getRange(rowIndex, 1, 1, SHEET_HEADERS.length).getValues()[0];
    return {
      timestamp: Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'MMMM d, yyyy h:mm a'),
      employeeName: row[1],
      branchDepartment: row[2],
      contactNumber: normalizeMobileNumber_(row[3]),
      gcashMobileNumber: normalizeMobileNumber_(row[4]),
      declarationAccepted: row[5]
    };
  });
}
```

with:

```js
function getSubmissionsFields(passcode, rowIndexes) {
  requireAdmin_(passcode);
  var sheet = getSheet_();
  return rowIndexes.map(function (rowIndex) {
    var row = sheet.getRange(rowIndex, 1, 1, SHEET_HEADERS.length).getValues()[0];
    return {
      timestamp: Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'MMMM d, yyyy h:mm a'),
      employeeName: row[1],
      firstName: row[2],
      middleName: row[3],
      lastName: row[4],
      birthday: row[5],
      cityProvince: row[6],
      branchDepartment: row[7],
      contactNumber: normalizeMobileNumber_(row[8]),
      gcashMobileNumber: normalizeMobileNumber_(row[9]),
      declarationAccepted: row[10]
    };
  });
}
```

- [ ] **Step 4: Update `getSubmissionsMedia`'s file-id extraction indices**

Replace:

```js
  var fileIds = [];
  rows.forEach(function (row) {
    fileIds.push(extractFileId_(row[6]), extractFileId_(row[7]));
  });
```

with:

```js
  var fileIds = [];
  rows.forEach(function (row) {
    fileIds.push(extractFileId_(row[11]), extractFileId_(row[12]));
  });
```

- [ ] **Step 5: Syntax-check**

```bash
cp apps-script/Code.gs /tmp/code-check.js && node --check /tmp/code-check.js && echo OK
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add apps-script/Code.gs
git commit -m "Update admin read paths (listSubmissions/getSubmissionsFields/getSubmissionsMedia/getSubmissionDetail) for the new Sheet column layout"
```

---

### Task 4: Public form fields — HTML and CSS (`index.html`)

**Files:**
- Modify: `index.html:95-97` and `index.html:105-107` (CSS)
- Modify: `index.html:355-357` (field markup)
- Modify: `index.html:425` (review screen)

- [ ] **Step 1: Add `input[type="date"]` to the shared input styling**

Replace:

```css
  input[type="text"],
  input[type="tel"],
  input[type="file"] {
    width: 100%;
    padding: 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 1rem;
  }

  input[type="text"]:focus,
  input[type="tel"]:focus,
  input[type="file"]:focus,
```

with:

```css
  input[type="text"],
  input[type="tel"],
  input[type="date"],
  input[type="file"] {
    width: 100%;
    padding: 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 1rem;
  }

  input[type="text"]:focus,
  input[type="tel"]:focus,
  input[type="date"]:focus,
  input[type="file"]:focus,
```

- [ ] **Step 2: Replace the single "Employee Name" field with First/Middle/Last Name, Birthday, City/Province**

Replace:

```html
          <label for="employeeName">Employee Name <span class="required" aria-hidden="true">*</span></label>
          <input type="text" id="employeeName" name="employeeName" required aria-describedby="err-employeeName">
          <span class="error" id="err-employeeName"></span>
```

with:

```html
          <label for="firstName">First Name <span class="required" aria-hidden="true">*</span></label>
          <input type="text" id="firstName" name="firstName" required aria-describedby="err-firstName">
          <span class="error" id="err-firstName"></span>

          <label for="middleName">Middle Name</label>
          <input type="text" id="middleName" name="middleName" aria-describedby="err-middleName">
          <span class="error" id="err-middleName"></span>

          <label for="lastName">Last Name <span class="required" aria-hidden="true">*</span></label>
          <input type="text" id="lastName" name="lastName" required aria-describedby="err-lastName">
          <span class="error" id="err-lastName"></span>

          <label for="birthday">Birthday <span class="required" aria-hidden="true">*</span></label>
          <input type="date" id="birthday" name="birthday" required aria-describedby="err-birthday">
          <span class="error" id="err-birthday"></span>

          <label for="cityProvince">City/Province <span class="required" aria-hidden="true">*</span></label>
          <input type="text" id="cityProvince" name="cityProvince" required aria-describedby="err-cityProvince">
          <span class="error" id="err-cityProvince"></span>
```

- [ ] **Step 3: Replace the "Employee Name" review row with rows for the 5 new fields**

Replace:

```html
        <div class="review-field"><span class="review-label">Employee Name</span><span id="review-employeeName"></span></div>
```

with:

```html
        <div class="review-field"><span class="review-label">First Name</span><span id="review-firstName"></span></div>
        <div class="review-field"><span class="review-label">Middle Name</span><span id="review-middleName"></span></div>
        <div class="review-field"><span class="review-label">Last Name</span><span id="review-lastName"></span></div>
        <div class="review-field"><span class="review-label">Birthday</span><span id="review-birthday"></span></div>
        <div class="review-field"><span class="review-label">City/Province</span><span id="review-cityProvince"></span></div>
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add First/Middle/Last Name, Birthday, City/Province markup to the enrollment form"
```

(Syntax-checked together with the JS changes in Task 5, since HTML markup alone isn't `node --check`-able.)

---

### Task 5: Public form logic — JS validation, review, payload (`index.html`)

**Files:**
- Modify: `index.html:584-593` (field reads + required checks)
- Modify: `index.html:612-613` (review population)
- Modify: `index.html:632-633` (`pendingSubmission`)
- Modify: `index.html:662-664` (submission `payload`)

- [ ] **Step 1: Replace the `employeeName` read with the 5 new field reads**

Replace:

```js
          var employeeName = document.getElementById('employeeName').value.trim();
          var branchDepartment = document.getElementById('branchDepartment').value.trim();
```

with:

```js
          var firstName = document.getElementById('firstName').value.trim();
          var middleName = document.getElementById('middleName').value.trim();
          var lastName = document.getElementById('lastName').value.trim();
          var birthday = document.getElementById('birthday').value.trim();
          var cityProvince = document.getElementById('cityProvince').value.trim();
          var branchDepartment = document.getElementById('branchDepartment').value.trim();
```

- [ ] **Step 2: Replace the `employeeName` required check with checks for First Name, Last Name, Birthday, City/Province**

Replace:

```js
          if (!employeeName) { setError('employeeName', 'Required.'); valid = false; }
          if (!branchDepartment) { setError('branchDepartment', 'Required.'); valid = false; }
```

with:

```js
          if (!firstName) { setError('firstName', 'Required.'); valid = false; }
          if (!lastName) { setError('lastName', 'Required.'); valid = false; }
          if (!birthday) { setError('birthday', 'Required.'); valid = false; }
          if (!cityProvince) { setError('cityProvince', 'Required.'); valid = false; }
          if (!branchDepartment) { setError('branchDepartment', 'Required.'); valid = false; }
```

(No check added for `middleName` — it's optional.)

- [ ] **Step 3: Replace the review-screen population for `employeeName`**

Replace:

```js
          document.getElementById('review-employeeName').textContent = employeeName;
          document.getElementById('review-branchDepartment').textContent = branchDepartment;
```

with:

```js
          document.getElementById('review-firstName').textContent = firstName;
          document.getElementById('review-middleName').textContent = middleName;
          document.getElementById('review-lastName').textContent = lastName;
          document.getElementById('review-birthday').textContent = birthday;
          document.getElementById('review-cityProvince').textContent = cityProvince;
          document.getElementById('review-branchDepartment').textContent = branchDepartment;
```

- [ ] **Step 4: Replace `employeeName` in `pendingSubmission`**

Replace:

```js
          pendingSubmission = {
            employeeName: employeeName,
            branchDepartment: branchDepartment,
```

with:

```js
          pendingSubmission = {
            firstName: firstName,
            middleName: middleName,
            lastName: lastName,
            birthday: birthday,
            cityProvince: cityProvince,
            branchDepartment: branchDepartment,
```

- [ ] **Step 5: Replace `employeeName` in the submission `payload`**

Replace:

```js
            var payload = {
              employeeName: pendingSubmission.employeeName,
              branchDepartment: pendingSubmission.branchDepartment,
```

with:

```js
            var payload = {
              firstName: pendingSubmission.firstName,
              middleName: pendingSubmission.middleName,
              lastName: pendingSubmission.lastName,
              birthday: pendingSubmission.birthday,
              cityProvince: pendingSubmission.cityProvince,
              branchDepartment: pendingSubmission.branchDepartment,
```

- [ ] **Step 6: Syntax-check the extracted script block**

```bash
sed -n '/<script>/,/<\/script>/p' index.html | sed '1d;$d' > /tmp/index-check.js && node --check /tmp/index-check.js && echo OK
```

Expected: `OK`

- [ ] **Step 7: Manual browser check**

Open `index.html` directly in a browser (double-click, or `file://` — no print/submit is needed for this check, so the `file://` print limitation from `CLAUDE.md` doesn't apply here). Verify:
- First Name, Last Name, Birthday, and City/Province show "Required." errors when left blank and the form is submitted.
- Middle Name does **not** show a required error when left blank.
- Filling in valid values for every required field and clicking through to the review screen shows First Name, Middle Name (if provided), Last Name, Birthday, and City/Province correctly on the review screen.

Do not click "Confirm & Submit" during this check unless you intend to create a real row in the production Sheet/Drive folder — full end-to-end submission is covered in Task 8's post-deploy check instead.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Wire First/Middle/Last Name, Birthday, City/Province through form validation, review, and submission payload"
```

---

### Task 6: Admin dashboard fields — detail view and print card (`admin.html`)

**Files:**
- Modify: `admin.html:928-932` (single-record detail view)
- Modify: `admin.html:977-981` (`recordCardTemplate`, used for printing)

- [ ] **Step 1: Add Birthday and City/Province rows to the detail view**

Replace:

```html
          <div class="record-field"><span class="label">Date Submitted</span><span id="d-timestamp"></span></div>
          <div class="record-field"><span class="label">Employee Name</span><span id="d-employeeName"></span></div>
          <div class="record-field"><span class="label">Branch/Department</span><span id="d-branchDepartment"></span></div>
          <div class="record-field"><span class="label">Contact Number</span><span id="d-contactNumber"></span></div>
          <div class="record-field"><span class="label">Verified GCash Mobile Number</span><span id="d-gcashMobileNumber"></span></div>
```

with:

```html
          <div class="record-field"><span class="label">Date Submitted</span><span id="d-timestamp"></span></div>
          <div class="record-field"><span class="label">Employee Name</span><span id="d-employeeName"></span></div>
          <div class="record-field"><span class="label">Birthday</span><span id="d-birthday"></span></div>
          <div class="record-field"><span class="label">City/Province</span><span id="d-cityProvince"></span></div>
          <div class="record-field"><span class="label">Branch/Department</span><span id="d-branchDepartment"></span></div>
          <div class="record-field"><span class="label">Contact Number</span><span id="d-contactNumber"></span></div>
          <div class="record-field"><span class="label">Verified GCash Mobile Number</span><span id="d-gcashMobileNumber"></span></div>
```

- [ ] **Step 2: Add the same two rows to the printed-record template**

Replace:

```html
        <div class="record-field"><span class="label">Date Submitted</span><span class="f-timestamp"></span></div>
        <div class="record-field"><span class="label">Employee Name</span><span class="f-employeeName"></span></div>
        <div class="record-field"><span class="label">Branch/Department</span><span class="f-branchDepartment"></span></div>
        <div class="record-field"><span class="label">Contact Number</span><span class="f-contactNumber"></span></div>
        <div class="record-field"><span class="label">Verified GCash Mobile Number</span><span class="f-gcashMobileNumber"></span></div>
```

with:

```html
        <div class="record-field"><span class="label">Date Submitted</span><span class="f-timestamp"></span></div>
        <div class="record-field"><span class="label">Employee Name</span><span class="f-employeeName"></span></div>
        <div class="record-field"><span class="label">Birthday</span><span class="f-birthday"></span></div>
        <div class="record-field"><span class="label">City/Province</span><span class="f-cityProvince"></span></div>
        <div class="record-field"><span class="label">Branch/Department</span><span class="f-branchDepartment"></span></div>
        <div class="record-field"><span class="label">Contact Number</span><span class="f-contactNumber"></span></div>
        <div class="record-field"><span class="label">Verified GCash Mobile Number</span><span class="f-gcashMobileNumber"></span></div>
```

**Note:** this adds two rows of vertical height to the printed record, which `CLAUDE.md`'s print-layout gotchas warn is tightly tuned to fit one Letter page. Task 7's manual check includes verifying the print preview still fits on one page — do not assume it does.

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "Add Birthday and City/Province rows to the admin detail view and printed record"
```

(Syntax-checked together with the JS changes in Task 7.)

---

### Task 7: Admin dashboard logic — JS population and CSV export (`admin.html`)

**Files:**
- Modify: `admin.html:1504-1511` (`renderDetailFields`)
- Modify: `admin.html:1545-1550` (`renderBulkPrintFields`)
- Modify: `admin.html:1261-1284` (CSV export)

- [ ] **Step 1: Populate Birthday and City/Province in `renderDetailFields`**

Replace:

```js
        function renderDetailFields(detail) {
          document.getElementById('d-timestamp').textContent = detail.timestamp;
          document.getElementById('d-employeeName').textContent = detail.employeeName;
          document.getElementById('d-branchDepartment').textContent = detail.branchDepartment;
          document.getElementById('d-contactNumber').textContent = detail.contactNumber;
          document.getElementById('d-gcashMobileNumber').textContent = detail.gcashMobileNumber;
          document.getElementById('d-printedName').textContent = detail.employeeName;
        }
```

with:

```js
        function renderDetailFields(detail) {
          document.getElementById('d-timestamp').textContent = detail.timestamp;
          document.getElementById('d-employeeName').textContent = detail.employeeName;
          document.getElementById('d-birthday').textContent = detail.birthday;
          document.getElementById('d-cityProvince').textContent = detail.cityProvince;
          document.getElementById('d-branchDepartment').textContent = detail.branchDepartment;
          document.getElementById('d-contactNumber').textContent = detail.contactNumber;
          document.getElementById('d-gcashMobileNumber').textContent = detail.gcashMobileNumber;
          document.getElementById('d-printedName').textContent = detail.employeeName;
        }
```

- [ ] **Step 2: Populate Birthday and City/Province in `renderBulkPrintFields`**

Replace:

```js
            card.querySelector('.f-timestamp').textContent = detail.timestamp;
            card.querySelector('.f-employeeName').textContent = detail.employeeName;
            card.querySelector('.f-branchDepartment').textContent = detail.branchDepartment;
            card.querySelector('.f-contactNumber').textContent = detail.contactNumber;
            card.querySelector('.f-gcashMobileNumber').textContent = detail.gcashMobileNumber;
            card.querySelector('.f-printedName').textContent = detail.employeeName;
```

with:

```js
            card.querySelector('.f-timestamp').textContent = detail.timestamp;
            card.querySelector('.f-employeeName').textContent = detail.employeeName;
            card.querySelector('.f-birthday').textContent = detail.birthday;
            card.querySelector('.f-cityProvince').textContent = detail.cityProvince;
            card.querySelector('.f-branchDepartment').textContent = detail.branchDepartment;
            card.querySelector('.f-contactNumber').textContent = detail.contactNumber;
            card.querySelector('.f-gcashMobileNumber').textContent = detail.gcashMobileNumber;
            card.querySelector('.f-printedName').textContent = detail.employeeName;
```

- [ ] **Step 3: Add the 5 new fields to the CSV export**

Replace:

```js
        document.getElementById('exportCsvBtn').addEventListener('click', function () {
          var headers = ['Date', 'Employee Name', 'Branch/Department', 'Contact Number', 'GCash Mobile Number'];
          var lines = [headers.map(csvCell).join(',')];

          currentFilteredRows.forEach(function (row) {
            lines.push([
              csvCell(row.timestamp),
              csvCell(row.employeeName),
              csvCell(row.branchDepartment),
              csvMobileNumberCell(row.contactNumber),
              csvMobileNumberCell(row.gcashMobileNumber)
            ].join(','));
          });
```

with:

```js
        document.getElementById('exportCsvBtn').addEventListener('click', function () {
          var headers = ['Date', 'Employee Name', 'First Name', 'Middle Name', 'Last Name', 'Birthday', 'City/Province', 'Branch/Department', 'Contact Number', 'GCash Mobile Number'];
          var lines = [headers.map(csvCell).join(',')];

          currentFilteredRows.forEach(function (row) {
            lines.push([
              csvCell(row.timestamp),
              csvCell(row.employeeName),
              csvCell(row.firstName),
              csvCell(row.middleName),
              csvCell(row.lastName),
              csvCell(row.birthday),
              csvCell(row.cityProvince),
              csvCell(row.branchDepartment),
              csvMobileNumberCell(row.contactNumber),
              csvMobileNumberCell(row.gcashMobileNumber)
            ].join(','));
          });
```

- [ ] **Step 4: Syntax-check the extracted script block**

```bash
sed -n '/<script>/,/<\/script>/p' admin.html | sed '1d;$d' > /tmp/admin-check.js && node --check /tmp/admin-check.js && echo OK
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add admin.html
git commit -m "Populate Birthday and City/Province in the admin detail view, print card, and CSV export"
```

---

### Task 8: Manual Sheet migration and coordinated deploy

This task has no code changes. It is the operational step that makes the schema change safe for the live, already-populated Sheet, followed by verification once everything is live. Per `CLAUDE.md`, pushing to `main` triggers both the GitHub Pages deploy (`index.html`/`admin.html`) and the Apps Script deploy (`Code.gs`) automatically within about a minute — there is no separate manual redeploy step for the code itself.

- [ ] **Step 1: Confirm with the user before proceeding**

Pushing to `main` affects the live production form and dashboard, and the Sheet edit below is a structural change to production data. Both require explicit user confirmation before proceeding — do not push or edit the live Sheet unilaterally.

- [ ] **Step 2: Insert 5 blank columns in the live Sheet**

In the Sheet ("Photoline GCash Payroll Enrollment Responses"), select columns C through H (Branch/Department, Contact Number, Verified GCash Mobile Number, Declaration Accepted, GCash Screenshot Link, Signature Link) → right-click the column header → "Insert 5 columns left". Confirm the existing data in what are now columns H–M is unchanged and columns C–G are blank.

- [ ] **Step 3: Push immediately after Step 2**

```bash
git push
```

Do this right after Step 2, not before — pushing first would let new code try to read the new column positions from a Sheet still in the old layout. There is an unavoidable brief window (roughly the ~1 minute Apps Script deploy takes) where a submission could race the deploy; note this to the user rather than treating it as fully eliminated.

- [ ] **Step 4: Post-deploy verification**

Wait about a minute for the Apps Script deploy to complete, then:
- Submit a real test enrollment through the live form (this creates a real row — delete it from the Sheet and the Drive attachments folder afterward if it's not a genuine submission).
- Open the admin dashboard, view that record, and confirm First Name, Middle Name, Last Name, Birthday, and City/Province all display correctly in the detail view.
- Open the print preview (Ctrl+P / Cmd+P per the on-page instruction) and confirm the record still fits on one Letter page with the two new rows added — re-check the `@media print` sizing in `admin.html` per `CLAUDE.md`'s print-layout gotchas if it doesn't.
- Export CSV and confirm the new columns appear with correct values.
- Open a pre-migration (old) record in the admin dashboard and confirm its Employee Name still displays correctly, with Birthday/City-Province blank (expected, since old rows never collected that data).

- [ ] **Step 5: Update `RESUME.md` / `CLAUDE.md` if needed**

If this session's work should be reflected in the project's running documentation (per this repo's convention of keeping `RESUME.md` and `CLAUDE.md` in sync with the deployed state), update them to describe the new form fields and the 13-column Sheet schema.
