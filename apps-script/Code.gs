const SHEET_ID = '1ABfSo4OLCezvRlrO2dv5kr0_PiwQ_lStwe46zEyQnaY';
const FOLDER_NAME = 'GCash Payroll Enrollment Attachments';
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
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function setup() {
  var sheet = getOrCreateSheet_();
  var folder = getOrCreateFolder_();
  Logger.log('Sheet ready: ' + sheet.getParent().getUrl());
  Logger.log('Folder ready: ' + folder.getUrl());
}

function getOrCreateSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
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

  var createdFiles = [];
  try {
    var screenshotBlob = base64ToBlob_(
      formData.screenshotBase64,
      formData.screenshotMimeType,
      stamp + '_' + namePart + '_GCashScreenshot' + extensionFor_(formData.screenshotMimeType)
    );
    var screenshotFile = folder.createFile(screenshotBlob);
    createdFiles.push(screenshotFile);

    var signatureBlob = base64ToBlob_(
      formData.signatureBase64,
      'image/png',
      stamp + '_' + namePart + '_Signature.png'
    );
    var signatureFile = folder.createFile(signatureBlob);
    createdFiles.push(signatureFile);

    sheet.appendRow([
      now,
      sanitizeForSheet_(formData.employeeName),
      sanitizeForSheet_(formData.branchDepartment),
      sanitizeForSheet_(formData.contactNumber),
      sanitizeForSheet_(formData.gcashMobileNumber),
      'Yes',
      screenshotFile.getUrl(),
      signatureFile.getUrl()
    ]);
  } catch (e) {
    createdFiles.forEach(function (file) {
      file.setTrashed(true);
    });
    throw e;
  }

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

function sanitizeForSheet_(value) {
  var str = String(value);
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}

// deploy trigger: verifying GitHub Actions auto-deploy