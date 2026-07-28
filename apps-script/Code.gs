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
  ensureAdminPasscode_();
  Logger.log('Sheet ready: ' + sheet.getParent().getUrl());
  Logger.log('Folder ready: ' + folder.getUrl());
}

function ensureAdminPasscode_() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASSCODE')) {
    var passcode = Utilities.getUuid().split('-')[0];
    props.setProperty('ADMIN_PASSCODE', passcode);
    Logger.log('Admin passcode set: ' + passcode);
  }
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

function doGet(e) {
  var isAdmin = e && e.parameter && e.parameter.page === 'admin';
  return HtmlService.createTemplateFromFile(isAdmin ? 'Admin' : 'Index')
    .evaluate()
    .setTitle(isAdmin ? 'GCash Payroll Enrollment - Admin' : 'GCash Payroll Enrollment Form')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ success: false, errors: ['Invalid request body.'] });
  }

  if (body.action === 'listSubmissions') {
    return jsonResponse_(safeAdminCall_(function () { return listSubmissions(body.passcode); }));
  }
  if (body.action === 'getSubmissionsFields') {
    return jsonResponse_(safeAdminCall_(function () { return getSubmissionsFields(body.passcode, body.rowIndexes); }));
  }
  if (body.action === 'getSubmissionsMedia') {
    return jsonResponse_(safeAdminCall_(function () { return getSubmissionsMedia(body.passcode, body.rowIndexes); }));
  }

  var result;
  try {
    result = submitForm(body);
  } catch (err) {
    result = { success: false, errors: ['Server error: ' + err.message] };
  }
  return jsonResponse_(result);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeAdminCall_(fn) {
  try {
    return { success: true, data: fn() };
  } catch (err) {
    return { success: false, errors: [err.message] };
  }
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
      sanitizeMobileForSheet_(formData.contactNumber),
      sanitizeMobileForSheet_(formData.gcashMobileNumber),
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

  var mobileNumberPattern = /^09\d{9}$/;
  if (formData.contactNumber && !mobileNumberPattern.test(String(formData.contactNumber).trim())) {
    errors.push('contactNumber must be an 11-digit mobile number starting with 09.');
  }
  if (formData.gcashMobileNumber && !mobileNumberPattern.test(String(formData.gcashMobileNumber).trim())) {
    errors.push('gcashMobileNumber must be an 11-digit mobile number starting with 09.');
  }

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

function sanitizeMobileForSheet_(value) {
  return "'" + String(value);
}

function normalizeMobileNumber_(value) {
  var digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (digits.length === 10 && digits.charAt(0) !== '0') {
    digits = '0' + digits;
  }
  return digits;
}

function requireAdmin_(passcode) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSCODE');
  if (!expected || passcode !== expected) {
    throw new Error('Invalid admin passcode.');
  }
}

function listSubmissions(passcode) {
  requireAdmin_(passcode);
  var sheet = getOrCreateSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var data = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.length).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    result.push({
      rowIndex: i + 2,
      timestamp: Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
      timestampIso: Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
      employeeName: data[i][1],
      branchDepartment: data[i][2],
      contactNumber: normalizeMobileNumber_(data[i][3]),
      gcashMobileNumber: normalizeMobileNumber_(data[i][4])
    });
  }
  return result;
}

// Kept for apps-script/Admin.html (legacy surface), which calls this
// directly via google.script.run rather than through doPost. The
// standalone admin.html uses the faster split getSubmissionsFields/
// getSubmissionsMedia actions below instead - see CLAUDE.md.
function getSubmissionDetail(passcode, rowIndex) {
  requireAdmin_(passcode);
  var sheet = getOrCreateSheet_();
  var row = sheet.getRange(rowIndex, 1, 1, SHEET_HEADERS.length).getValues()[0];

  var screenshotId = extractFileId_(row[6]);
  var signatureId = extractFileId_(row[7]);
  var screenshotBlob = screenshotId ? DriveApp.getFileById(screenshotId).getBlob() : null;
  var signatureBlob = signatureId ? DriveApp.getFileById(signatureId).getBlob() : null;

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

function getSubmissionsFields(passcode, rowIndexes) {
  requireAdmin_(passcode);
  var sheet = getOrCreateSheet_();
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

function getSubmissionsMedia(passcode, rowIndexes) {
  requireAdmin_(passcode);
  var sheet = getOrCreateSheet_();
  return rowIndexes.map(function (rowIndex) {
    var row = sheet.getRange(rowIndex, 1, 1, SHEET_HEADERS.length).getValues()[0];
    var screenshotId = extractFileId_(row[6]);
    var signatureId = extractFileId_(row[7]);
    var screenshotBlob = screenshotId ? DriveApp.getFileById(screenshotId).getBlob() : null;
    var signatureBlob = signatureId ? DriveApp.getFileById(signatureId).getBlob() : null;
    return {
      screenshotBase64: screenshotBlob ? Utilities.base64Encode(screenshotBlob.getBytes()) : null,
      screenshotMimeType: screenshotBlob ? screenshotBlob.getContentType() : null,
      signatureBase64: signatureBlob ? Utilities.base64Encode(signatureBlob.getBytes()) : null
    };
  });
}

function extractFileId_(url) {
  var match = String(url).match(/[-\w]{25,}/);
  return match ? match[0] : null;
}