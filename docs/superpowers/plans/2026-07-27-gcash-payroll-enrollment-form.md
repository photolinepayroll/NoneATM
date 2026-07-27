# GCash Payroll Enrollment Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable Google Apps Script web app that gives Photoline Enterprises Corporation employees a mobile-friendly GCash payroll enrollment form, writing responses to a named Google Sheet and files (screenshot + signature) to a named Google Drive folder.

**Architecture:** A standalone Google Apps Script project (`Code.gs` + `Index.html` + `Styles.html` + `ClientScript.html` + `appsscript.json`) deployed as a Web App. `setup()` creates the Sheet/Folder on first run; `doGet` serves the form; `submitForm` (called via `google.script.run`) re-validates everything server-side and writes the row + files.

**Tech Stack:** Google Apps Script (V8 runtime), HTML Service, SpreadsheetApp, DriveApp, vanilla JS (canvas-based signature pad, no external libraries).

**Note on verification:** Apps Script has no local unit-test runner without additional tooling (`clasp` + a mocking library), which would be disproportionate scope for a single internal HR form. Each task's verification step is therefore a concrete manual check performed in the Apps Script editor (via `Logger.log`/execution transcript) or in the deployed web app's browser preview, with an exact expected result — this plan's equivalent of "run the test and confirm the output."

All files are created under `D:\AI Cowork Project\GCASH enrollment\apps-script\`. These files are copy-pasted into a Google Apps Script project by the user (see Task 6 for exact steps) — no direct API access to the user's Google account is used to create them.

---

### Task 1: Project scaffold + manifest + Sheet/Folder setup logic

**Files:**
- Create: `D:\AI Cowork Project\GCASH enrollment\apps-script\appsscript.json`
- Create: `D:\AI Cowork Project\GCASH enrollment\apps-script\Code.gs`

- [ ] **Step 1: Create the Apps Script manifest**

```json
{
  "timeZone": "Asia/Manila",
  "dependencies": {},
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

Note in a comment in the deployment doc (Task 6) that `access` here is only the manifest default — the actual access level is chosen again in the Deploy dialog, where the user picks between their Workspace domain and "Anyone with the link."

- [ ] **Step 2: Write `Code.gs` with constants and the Sheet/Folder setup functions**

```javascript
var SHEET_NAME = 'Photoline GCash Payroll Enrollment Responses';
var FOLDER_NAME = 'GCash Payroll Enrollment Attachments';
var SHEET_HEADERS = [
  'Timestamp',
  'Employee Name',
  'Branch/Department',
  'Contact Number',
  'Verified GCash Mobile Number',
  'Declaration Accepted',
  'GCash Screenshot Link',
  'Signature Link'
];
var ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
var MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function setup() {
  var sheet = getOrCreateSheet_();
  var folder = getOrCreateFolder_();
  Logger.log('Sheet ready: ' + sheet.getParent().getUrl());
  Logger.log('Folder ready: ' + folder.getUrl());
}

function getOrCreateSheet_() {
  var files = DriveApp.getFilesByName(SHEET_NAME);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(SHEET_NAME);
  }
  var sheet = ss.getSheets()[0];
  var firstRow = sheet.getRange(1, 1, 1, SHEET_HEADERS.length).getValues()[0];
  var hasHeaders = SHEET_HEADERS.every(function (h, i) { return firstRow[i] === h; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateFolder_() {
  var folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(FOLDER_NAME);
}
```

- [ ] **Step 3: Manual verification — run `setup()` once these files exist in an Apps Script project**

This step can only be executed after Task 6 (the files are pasted into a real Apps Script project — there is no local Apps Script runtime). Record it here so it isn't skipped later:

Run: select `setup` in the Apps Script editor's function dropdown, click Run.
Expected: Execution log shows two lines starting with `Sheet ready:` and `Folder ready:`, each followed by a Drive URL. Opening those URLs shows a new Sheet named exactly "Photoline GCash Payroll Enrollment Responses" with the 8 header names in row 1, and a new Drive folder named exactly "GCash Payroll Enrollment Attachments" (empty).
Run `setup()` a second time. Expected: log shows the same two URLs (no duplicate Sheet/Folder created) — confirms the "find or create" logic is idempotent.

- [ ] **Step 4: Commit is not applicable (no git repository in this project) — skip to Task 2.**

---

### Task 2: Form submission logic (validation, file saving, row append)

**Files:**
- Modify: `D:\AI Cowork Project\GCASH enrollment\apps-script\Code.gs`

- [ ] **Step 1: Append `doGet`, `include`, `submitForm`, and helper functions to `Code.gs`**

```javascript
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('GCash Payroll Enrollment Form')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function submitForm(formData) {
  var errors = validateSubmission_(formData);
  if (errors.length > 0) {
    return { success: false, errors: errors };
  }

  var folder = getOrCreateFolder_();
  var sheet = getOrCreateSheet_();

  var now = new Date();
  var namePart = String(formData.employeeName).replace(/[^a-zA-Z0-9]/g, '');
  var stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');

  var screenshotBlob = base64ToBlob_(
    formData.screenshotBase64,
    formData.screenshotMimeType,
    stamp + '_' + namePart + '_GCashScreenshot' + extensionFor_(formData.screenshotMimeType)
  );
  var screenshotFile = folder.createFile(screenshotBlob);

  var signatureBlob = base64ToBlob_(
    formData.signatureBase64,
    'image/png',
    stamp + '_' + namePart + '_Signature.png'
  );
  var signatureFile = folder.createFile(signatureBlob);

  sheet.appendRow([
    now,
    formData.employeeName,
    formData.branchDepartment,
    formData.contactNumber,
    formData.gcashMobileNumber,
    'Yes',
    screenshotFile.getUrl(),
    signatureFile.getUrl()
  ]);

  return { success: true };
}

function validateSubmission_(formData) {
  var errors = [];
  ['employeeName', 'branchDepartment', 'contactNumber', 'gcashMobileNumber'].forEach(function (field) {
    if (!formData[field] || String(formData[field]).trim() === '') {
      errors.push(field + ' is required.');
    }
  });

  if (!formData.declarationAccepted) {
    errors.push('Declaration must be accepted.');
  }

  if (!formData.screenshotBase64 || !formData.screenshotMimeType) {
    errors.push('Screenshot is required.');
  } else {
    if (ALLOWED_MIME_TYPES.indexOf(formData.screenshotMimeType) === -1) {
      errors.push('Screenshot must be JPG, PNG, or PDF.');
    }
    var sizeBytes = Math.ceil(formData.screenshotBase64.length * 3 / 4);
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      errors.push('Screenshot must be 10MB or smaller.');
    }
  }

  if (!formData.signatureBase64 || formData.signatureBase64.length < 100) {
    errors.push('Signature is required.');
  }

  return errors;
}

function base64ToBlob_(base64Data, mimeType, filename) {
  var bytes = Utilities.base64Decode(base64Data);
  return Utilities.newBlob(bytes, mimeType, filename);
}

function extensionFor_(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'application/pdf') return '.pdf';
  return '.jpg';
}
```

- [ ] **Step 2: Manual verification — server-side validation, run from the Apps Script editor**

Add a temporary throwaway function, run it once, then delete it (do not leave test scaffolding in `Code.gs`):

```javascript
function _manualTest_rejectsEmptyFields() {
  var result = submitForm({});
  Logger.log(JSON.stringify(result));
}
```

Run: select `_manualTest_rejectsEmptyFields`, click Run.
Expected log output: `{"success":false,"errors":["employeeName is required.","branchDepartment is required.","contactNumber is required.","gcashMobileNumber is required.","Declaration must be accepted.","Screenshot is required.","Signature is required."]}`
Confirm no row was added to the Sheet and no file was added to the Drive folder.
Delete `_manualTest_rejectsEmptyFields` from `Code.gs` afterward.

- [ ] **Step 3: Manual verification — full valid submission (1x1 PNG as a stand-in screenshot)**

```javascript
function _manualTest_acceptsValidSubmission() {
  var tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  var result = submitForm({
    employeeName: 'Test Employee',
    branchDepartment: 'Head Office',
    contactNumber: '09171234567',
    gcashMobileNumber: '09171234567',
    declarationAccepted: true,
    screenshotBase64: tinyPngBase64,
    screenshotMimeType: 'image/png',
    signatureBase64: tinyPngBase64
  });
  Logger.log(JSON.stringify(result));
}
```

Run: select `_manualTest_acceptsValidSubmission`, click Run.
Expected log output: `{"success":true}`
Confirm a new row appears in the Sheet with "Test Employee" and the other test values, and two new files appear in the Drive folder named `<timestamp>_TestEmployee_GCashScreenshot.png` and `<timestamp>_TestEmployee_Signature.png`.
Delete the test row from the Sheet, delete the two test files from Drive, and delete `_manualTest_acceptsValidSubmission` from `Code.gs` afterward — this was scaffolding, not real data.

---

### Task 3: Stylesheet

**Files:**
- Create: `D:\AI Cowork Project\GCASH enrollment\apps-script\Styles.html`

- [ ] **Step 1: Write `Styles.html`**

```html
<style>
  :root {
    --photoline-blue: #1a3fd1;
    --gcash-blue: #0072ce;
    --gcash-blue-dark: #00327a;
    --accent-red: #e2231a;
    --text-dark: #1a1a1a;
    --border-color: #d0d5dd;
    --error-red: #c0392b;
    --bg: #f5f7fb;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    background: var(--bg);
    color: var(--text-dark);
  }

  .container {
    max-width: 480px;
    margin: 0 auto;
    padding: 16px;
  }

  .header {
    text-align: center;
    margin-bottom: 24px;
  }

  .logo {
    max-width: 220px;
    width: 100%;
    height: auto;
    margin-bottom: 12px;
  }

  .header h1 {
    font-size: 1.3rem;
    color: var(--gcash-blue-dark);
    margin: 4px 0;
  }

  .purpose {
    font-size: 0.9rem;
    color: #555;
  }

  .section {
    background: #fff;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  .section h2 {
    font-size: 1rem;
    color: var(--photoline-blue);
    margin-top: 0;
  }

  label {
    display: block;
    font-weight: 600;
    margin-top: 12px;
    margin-bottom: 4px;
    font-size: 0.9rem;
  }

  .required {
    color: var(--accent-red);
  }

  input[type="text"],
  input[type="tel"],
  input[type="file"] {
    width: 100%;
    padding: 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 1rem;
  }

  .hint {
    font-size: 0.8rem;
    color: #666;
    margin: 4px 0;
  }

  .checkbox-label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    font-weight: 400;
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .checkbox-label input {
    margin-top: 4px;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  canvas#signaturePad {
    width: 100%;
    max-width: 100%;
    height: 160px;
    border: 2px dashed var(--border-color);
    border-radius: 8px;
    touch-action: none;
    background: #fff;
  }

  .signature-actions {
    margin-top: 8px;
    text-align: right;
  }

  .signature-actions button {
    background: #eee;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 0.85rem;
  }

  .submit-row {
    text-align: center;
    margin: 24px 0;
  }

  #submitBtn {
    background: var(--gcash-blue);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 14px 32px;
    font-size: 1rem;
    font-weight: 600;
    width: 100%;
  }

  #submitBtn:disabled {
    opacity: 0.6;
  }

  .spinner {
    margin: 12px auto 0;
    width: 24px;
    height: 24px;
    border: 3px solid var(--border-color);
    border-top-color: var(--gcash-blue);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error {
    display: block;
    color: var(--error-red);
    font-size: 0.8rem;
    margin-top: 4px;
    min-height: 1em;
  }

  .confirmation {
    background: #fff;
    border-radius: 10px;
    padding: 24px;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    font-size: 1rem;
    color: var(--gcash-blue-dark);
  }
</style>
```

- [ ] **Step 2: Verification** — visual check happens in Task 7 once the full page renders. No standalone check for a CSS-only file.

---

### Task 4: Form markup with embedded logo

**Files:**
- Create: `D:\AI Cowork Project\GCASH enrollment\apps-script\Index.html`
- Read: `D:\AI Cowork Project\GCASH enrollment\logo_base64.txt` (already generated — base64 encoding of `Logo.png`)

- [ ] **Step 1: Read the base64 string**

Run: open `D:\AI Cowork Project\GCASH enrollment\logo_base64.txt` and copy its full contents (one line, ~111,292 characters).

- [ ] **Step 2: Write `Index.html`**, using the copied string as the `src` of the logo `<img>` (shown here as `<BASE64_FROM_logo_base64.txt>` — replace with the real string, do not leave the placeholder in the file):

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <?!= include('Styles'); ?>
  </head>
  <body>
    <div class="container">
      <header class="header">
        <img class="logo" src="data:image/png;base64,<BASE64_FROM_logo_base64.txt>" alt="Photoline Enterprises Corporation / GCash">
        <h1>GCash Payroll Enrollment Form</h1>
        <p class="purpose">For employees without an ATM Savings Account. Enroll your own Verified GCash Account for salary crediting.</p>
      </header>

      <form id="enrollmentForm" novalidate>
        <section class="section">
          <h2>Section 1 &ndash; Employee Information</h2>

          <label for="employeeName">Employee Name <span class="required">*</span></label>
          <input type="text" id="employeeName" name="employeeName" required>
          <span class="error" id="err-employeeName"></span>

          <label for="branchDepartment">Branch/Department <span class="required">*</span></label>
          <input type="text" id="branchDepartment" name="branchDepartment" required>
          <span class="error" id="err-branchDepartment"></span>

          <label for="contactNumber">Contact Number <span class="required">*</span></label>
          <input type="tel" id="contactNumber" name="contactNumber" required>
          <span class="error" id="err-contactNumber"></span>

          <label for="gcashMobileNumber">Verified GCash Mobile Number <span class="required">*</span></label>
          <input type="tel" id="gcashMobileNumber" name="gcashMobileNumber" required>
          <span class="error" id="err-gcashMobileNumber"></span>
        </section>

        <section class="section">
          <h2>Section 2 &ndash; GCash Verification</h2>
          <label for="screenshot">Upload Screenshot of Verified GCash Account <span class="required">*</span></label>
          <p class="hint">Screenshot must clearly show your Employee Full Name, Verified Status, and GCash Mobile Number.</p>
          <p class="hint">Allowed file types: JPG, PNG, PDF. Maximum size: 10MB.</p>
          <input type="file" id="screenshot" name="screenshot" accept=".jpg,.jpeg,.png,.pdf" required>
          <span class="error" id="err-screenshot"></span>
        </section>

        <section class="section">
          <h2>Section 3 &ndash; Employee Declaration</h2>
          <label class="checkbox-label">
            <input type="checkbox" id="declarationAccepted" name="declarationAccepted" required>
            <span>I certify that the GCash account provided is my own Verified GCash Account. I authorize Photoline Enterprises Corporation to credit my salary and approved payments to this account until I submit a written request for changes. I understand that any delay or failed transaction caused by incorrect information I provided will be my responsibility.</span>
          </label>
          <span class="error" id="err-declarationAccepted"></span>
        </section>

        <section class="section">
          <h2>Section 4 &ndash; Electronic Signature</h2>
          <p class="hint">Sign using your finger below.</p>
          <canvas id="signaturePad" width="320" height="160"></canvas>
          <div class="signature-actions">
            <button type="button" id="clearSignature">Clear / Re-sign</button>
          </div>
          <span class="error" id="err-signature"></span>
        </section>

        <div class="submit-row">
          <button type="submit" id="submitBtn">Submit</button>
          <div id="spinner" class="spinner" hidden></div>
        </div>
        <span class="error" id="err-form"></span>
      </form>

      <div id="confirmation" class="confirmation" hidden>
        <p>Thank you! Your GCash Payroll Enrollment Form has been successfully submitted. The HR Department of Photoline Enterprises Corporation will review your information and may contact you for additional verification.</p>
      </div>
    </div>

    <?!= include('ClientScript'); ?>
  </body>
</html>
```

- [ ] **Step 3: Verification** — deferred to Task 7 (needs `ClientScript.html` from Task 5 to render/behave correctly; the `<img>` tag can be visually spot-checked as soon as both this file and Task 5's file exist in a deployed preview).

---

### Task 5: Signature pad, client-side validation, and submit handler

**Files:**
- Create: `D:\AI Cowork Project\GCASH enrollment\apps-script\ClientScript.html`

- [ ] **Step 1: Write `ClientScript.html`**

```html
<script>
  (function () {
    var canvas = document.getElementById('signaturePad');
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var hasSignature = false;

    function resizeCanvas() {
      var ratio = window.devicePixelRatio || 1;
      var rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1a1a1a';
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    function getPos(evt) {
      var rect = canvas.getBoundingClientRect();
      var point = evt.touches ? evt.touches[0] : evt;
      return { x: point.clientX - rect.left, y: point.clientY - rect.top };
    }

    function startDraw(evt) {
      evt.preventDefault();
      drawing = true;
      hasSignature = true;
      var pos = getPos(evt);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }

    function moveDraw(evt) {
      if (!drawing) return;
      evt.preventDefault();
      var pos = getPos(evt);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }

    function endDraw() {
      drawing = false;
    }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', endDraw);

    document.getElementById('clearSignature').addEventListener('click', function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasSignature = false;
    });

    function clearErrors() {
      document.querySelectorAll('.error').forEach(function (el) { el.textContent = ''; });
    }

    function setError(fieldId, message) {
      var el = document.getElementById('err-' + fieldId);
      if (el) el.textContent = message;
    }

    var ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'pdf'];
    var MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

    function readFileAsBase64(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          var result = reader.result;
          resolve(result.substring(result.indexOf(',') + 1));
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function canvasToBase64(cvs) {
      var dataUrl = cvs.toDataURL('image/png');
      return dataUrl.substring(dataUrl.indexOf(',') + 1);
    }

    document.getElementById('screenshot').addEventListener('change', function (evt) {
      setError('screenshot', '');
      var file = evt.target.files[0];
      if (!file) return;
      var ext = file.name.split('.').pop().toLowerCase();
      if (ALLOWED_EXTENSIONS.indexOf(ext) === -1) {
        setError('screenshot', 'File must be JPG, PNG, or PDF.');
        evt.target.value = '';
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError('screenshot', 'File must be 10MB or smaller.');
        evt.target.value = '';
      }
    });

    document.getElementById('enrollmentForm').addEventListener('submit', function (evt) {
      evt.preventDefault();
      clearErrors();

      var employeeName = document.getElementById('employeeName').value.trim();
      var branchDepartment = document.getElementById('branchDepartment').value.trim();
      var contactNumber = document.getElementById('contactNumber').value.trim();
      var gcashMobileNumber = document.getElementById('gcashMobileNumber').value.trim();
      var declarationAccepted = document.getElementById('declarationAccepted').checked;
      var screenshotInput = document.getElementById('screenshot');
      var screenshotFile = screenshotInput.files[0];

      var valid = true;
      if (!employeeName) { setError('employeeName', 'Required.'); valid = false; }
      if (!branchDepartment) { setError('branchDepartment', 'Required.'); valid = false; }
      if (!contactNumber) { setError('contactNumber', 'Required.'); valid = false; }
      if (!gcashMobileNumber) { setError('gcashMobileNumber', 'Required.'); valid = false; }
      if (!screenshotFile) { setError('screenshot', 'Screenshot is required.'); valid = false; }
      if (!declarationAccepted) { setError('declarationAccepted', 'You must accept the declaration.'); valid = false; }
      if (!hasSignature) { setError('signature', 'Signature is required.'); valid = false; }

      if (!valid) return;

      var submitBtn = document.getElementById('submitBtn');
      var spinner = document.getElementById('spinner');
      submitBtn.disabled = true;
      spinner.hidden = false;

      readFileAsBase64(screenshotFile).then(function (screenshotBase64) {
        var payload = {
          employeeName: employeeName,
          branchDepartment: branchDepartment,
          contactNumber: contactNumber,
          gcashMobileNumber: gcashMobileNumber,
          declarationAccepted: declarationAccepted,
          screenshotBase64: screenshotBase64,
          screenshotMimeType: screenshotFile.type,
          signatureBase64: canvasToBase64(canvas)
        };

        google.script.run
          .withSuccessHandler(function (response) {
            submitBtn.disabled = false;
            spinner.hidden = true;
            if (response.success) {
              document.getElementById('enrollmentForm').hidden = true;
              document.getElementById('confirmation').hidden = false;
            } else {
              setError('form', response.errors.join(' '));
            }
          })
          .withFailureHandler(function (error) {
            submitBtn.disabled = false;
            spinner.hidden = true;
            setError('form', 'Submission failed: ' + error.message + '. Please try again.');
          })
          .submitForm(payload);
      }).catch(function () {
        submitBtn.disabled = false;
        spinner.hidden = true;
        setError('screenshot', 'Could not read the selected file. Please try again.');
      });
    });
  })();
</script>
```

- [ ] **Step 2: Verification** — full end-to-end check happens in Task 7, since this file only works once deployed alongside `Code.gs` and `Index.html`.

---

### Task 6: Deployment guide

**Files:**
- Create: `D:\AI Cowork Project\GCASH enrollment\docs\DEPLOYMENT.md`

- [ ] **Step 1: Write the deployment guide**

```markdown
# Deploying the GCash Payroll Enrollment Form

1. Go to https://script.google.com and click "New project". (Use a standalone
   project, not one bound to an existing Sheet — `setup()` creates the Sheet
   for you, and a bound script's container Sheet would just be an unused
   duplicate.)
2. Rename the project (top left) to "GCash Payroll Enrollment Form".
3. In the file list, delete the default empty `Code.gs` content and paste in
   the contents of `apps-script/Code.gs` from this folder.
4. Click the "+" next to Files → HTML, name it `Index`, paste in the
   contents of `apps-script/Index.html`.
5. Repeat for `Styles` (HTML) and `ClientScript` (HTML) using
   `apps-script/Styles.html` and `apps-script/ClientScript.html`.
6. Click the gear icon (Project Settings) → check "Show `appsscript.json`
   manifest file in editor" → open `appsscript.json` → replace its contents
   with `apps-script/appsscript.json`.
7. Select `setup` from the function dropdown at the top, click "Run". The
   first run will prompt you to authorize the script (it needs Sheets and
   Drive access) — review and allow it.
8. Check the execution log (View → Logs) for the two URLs it printed. Open
   both to confirm the Sheet "Photoline GCash Payroll Enrollment Responses"
   and the folder "GCash Payroll Enrollment Attachments" now exist in your
   Drive.
9. Click "Deploy" → "New deployment" → gear icon → "Web app".
   - Description: "GCash Payroll Enrollment Form v1"
   - Execute as: **Me**
   - Who has access: **Anyone within [your Workspace domain]** if all
     employees have a company Google account, otherwise **Anyone** if some
     employees don't.
10. Click "Deploy", authorize again if prompted, and copy the Web App URL.
11. Open that URL on a phone to confirm the form loads with the logo, fill
    it out, and submit — see the end-to-end checklist in Task 7 of the
    implementation plan for the full pass/fail criteria.
12. Share the Web App URL with employees (e.g. via HR announcement, group
    chat, or a QR code pointing to it).

## Updating the form later

Any time you edit the code in the Apps Script editor, changes only take
effect for the deployed Web App after you go to Deploy → "Manage
deployments" → edit the existing deployment → New version → Deploy. Editing
the files alone does not update the live URL.
```

- [ ] **Step 2: Verification** — read the file back and confirm every numbered step matches the actual Apps Script editor UI terminology used in this plan (Deploy, New deployment, Web app, Execute as, Who has access) with no placeholder text left in.

---

### Task 7: End-to-end manual verification

**Files:** none (verification only, against the deployed Web App from Task 6)

- [ ] **Step 1: Happy path submission**

On a phone (or a browser with device toolbar set to a mobile width), open the
deployed Web App URL.
Expected: page loads within a few seconds, Photoline/GCash logo visible at
top, all 4 sections visible when scrolling, submit button visible at bottom.

Fill in all 4 text fields, upload a real image (jpg or png) under 10MB,
check the declaration checkbox, draw a signature with a finger/mouse, tap
Submit.
Expected: submit button shows a spinner briefly, then the form is replaced
by the exact confirmation text: "Thank you! Your GCash Payroll Enrollment
Form has been successfully submitted. The HR Department of Photoline
Enterprises Corporation will review your information and may contact you
for additional verification."

Open the Sheet "Photoline GCash Payroll Enrollment Responses".
Expected: one new row with the submitted values, a Timestamp column
populated with the current date/time, and both link columns pointing to
files that open successfully (the uploaded screenshot and the drawn
signature image).

- [ ] **Step 2: Validation failure path**

Reload the Web App URL, leave every field empty, and tap Submit without
filling anything in.
Expected: form does not submit, and an inline error message appears under
each of: Employee Name, Branch/Department, Contact Number, Verified GCash
Mobile Number, Screenshot, Declaration checkbox, and Signature. No network
request should be visible in the browser dev tools Network tab (client-side
check blocked it before calling the server).

- [ ] **Step 3: Oversized/wrong-type file rejection**

Attempt to select a file larger than 10MB, or a file type other than
jpg/png/pdf (e.g. a `.docx`), in the screenshot field.
Expected: an inline error appears under the Screenshot field immediately
after selecting the file, and the file input is cleared (does not silently
accept the bad file).

- [ ] **Step 4: Clear/re-sign**

Draw a signature, tap "Clear / Re-sign", confirm the canvas is now blank,
draw a new signature, then submit a fully valid form.
Expected: submission succeeds and the signature file saved to Drive matches
the second (re-signed) drawing, not the first.

- [ ] **Step 5: Record completion**

Once all four checks above pass, the form is ready to share with employees
per Task 6 Step 12. No commit step applies (no git repository in this
project).

---

## Post-plan cleanup

Delete `D:\AI Cowork Project\GCASH enrollment\logo_base64.txt` once Task 4 has
copied its contents into `Index.html` — it was a one-time intermediate
artifact, not something that needs to stay in the project long-term (the
logo is now embedded directly in `Index.html`).
