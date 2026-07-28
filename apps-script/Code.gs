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
const LIST_SUBMISSIONS_CACHE_KEY = 'listSubmissions_v1';
const LIST_SUBMISSIONS_CACHE_TTL_SECONDS = 30;

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

// Plain sheet handle, no header round-trip. Use this for every read-only
// admin call (listSubmissions/getSubmissionsFields/getSubmissionsMedia) -
// the header row never changes after setup(), so re-verifying it on every
// single request just adds a spreadsheet round-trip for nothing.
function getSheet_() {
  return SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
}

// Header-verifying variant - only needed on the write path (submitForm)
// and one-time setup(), where a missing/wrong header row would actually
// break appendRow's column alignment.
function getOrCreateSheet_() {
  var sheet = getSheet_();
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
  var params = (e && e.parameter) || {};

  // JSONP path for admin.html's data calls (listSubmissions/getSubmissionsFields/
  // getSubmissionsMedia/validatePasscode). A <script src="...&callback=..."> tag
  // load follows Google's redirect chain (script.google.com -> .../exec's
  // script.googleusercontent.com hop) at the browser's native script-loading
  // layer, which is more robust in some network/browser environments than
  // fetch() - fetch() was intermittently getting back an HTML error page
  // instead of JSON in exactly this redirect hop. Still fully passcode-gated -
  // same requireAdmin_ check as the POST path below, nothing is exposed
  // without a valid passcode.
  if (params.action && params.callback) {
    return handleAdminJsonp_(params);
  }

  var isAdmin = params.page === 'admin';
  return HtmlService.createTemplateFromFile(isAdmin ? 'Admin' : 'Index')
    .evaluate()
    .setTitle(isAdmin ? 'GCash Payroll Enrollment - Admin' : 'GCash Payroll Enrollment Form')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function handleAdminJsonp_(params) {
  var result = safeAdminCall_(function () {
    var rowIndexes = params.rowIndexes ? params.rowIndexes.split(',').map(Number) : null;

    if (params.action === 'validatePasscode') {
      requireAdmin_(params.passcode);
      return true;
    }
    if (params.action === 'listSubmissions') {
      return listSubmissions(params.passcode);
    }
    if (params.action === 'getSubmissionsFields') {
      return getSubmissionsFields(params.passcode, rowIndexes);
    }
    if (params.action === 'getSubmissionsMedia') {
      return getSubmissionsMedia(params.passcode, rowIndexes);
    }
    throw new Error('Unknown action.');
  });

  return jsonpResponse_(result, params.callback);
}

function jsonpResponse_(obj, callback) {
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
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

  if (body.action === 'validatePasscode') {
    return jsonResponse_(safeAdminCall_(function () { requireAdmin_(body.passcode); return true; }));
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
    invalidateListSubmissionsCache_();
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

  var cache = CacheService.getScriptCache();
  var cached = getCachedListSubmissions_(cache);
  if (cached) {
    return cached;
  }

  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var result = [];
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var timestamp = new Date(data[i][0]);
      result.push({
        rowIndex: i + 2,
        timestamp: Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
        timestampIso: Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
        employeeName: data[i][1],
        branchDepartment: data[i][2],
        contactNumber: normalizeMobileNumber_(data[i][3]),
        gcashMobileNumber: normalizeMobileNumber_(data[i][4])
      });
    }
  }

  setCachedListSubmissions_(cache, result);
  return result;
}

// Returns the cached listSubmissions result (parsed), or null on a cache
// miss or any unexpected problem reading/parsing the cache - a cache
// problem must never break the dashboard, only skip the speedup.
function getCachedListSubmissions_(cache) {
  try {
    var raw = cache.get(LIST_SUBMISSIONS_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

// Best-effort cache write. CacheService rejects values over 100KB per key;
// once the Sheet has enough rows for the JSON to cross that, this silently
// stops caching rather than throwing - every call just falls back to a live
// Sheet read, same as before this change existed.
function setCachedListSubmissions_(cache, result) {
  try {
    cache.put(LIST_SUBMISSIONS_CACHE_KEY, JSON.stringify(result), LIST_SUBMISSIONS_CACHE_TTL_SECONDS);
  } catch (err) {
    // Too large for a single cache entry, or some other transient
    // CacheService issue - not caching this round is fine.
  }
}

// Called by submitForm right after a successful appendRow so a brand-new
// submission is visible on the very next listSubmissions call instead of
// waiting out LIST_SUBMISSIONS_CACHE_TTL_SECONDS.
function invalidateListSubmissionsCache_() {
  try {
    CacheService.getScriptCache().remove(LIST_SUBMISSIONS_CACHE_KEY);
  } catch (err) {
    // Not fatal - at worst the next Refresh serves the stale cached list
    // until the TTL expires naturally.
  }
}

// Kept for apps-script/Admin.html (legacy surface), which calls this
// directly via google.script.run rather than through doGet/doPost. The
// standalone admin.html uses the faster split getSubmissionsFields/
// getSubmissionsMedia actions below instead (via doGet JSONP) - see
// CLAUDE.md.
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

function getSubmissionsMedia(passcode, rowIndexes) {
  requireAdmin_(passcode);
  var sheet = getSheet_();
  var rows = rowIndexes.map(function (rowIndex) {
    return sheet.getRange(rowIndex, 1, 1, SHEET_HEADERS.length).getValues()[0];
  });

  // One screenshot + one signature file id per row, fetched together below
  // instead of one DriveApp.getFileById().getBlob() call at a time - see
  // fetchFilesParallel_.
  var fileIds = [];
  rows.forEach(function (row) {
    fileIds.push(extractFileId_(row[6]), extractFileId_(row[7]));
  });
  var blobs = fetchFilesParallel_(fileIds);

  return rows.map(function (row, i) {
    var screenshotBlob = blobs[i * 2];
    var signatureBlob = blobs[i * 2 + 1];
    return {
      screenshotBase64: screenshotBlob ? Utilities.base64Encode(screenshotBlob.getBytes()) : null,
      screenshotMimeType: screenshotBlob ? screenshotBlob.getContentType() : null,
      signatureBase64: signatureBlob ? Utilities.base64Encode(signatureBlob.getBytes()) : null
    };
  });
}

// Cap how many files go into one UrlFetchApp.fetchAll() call. Bulk print
// with a large selection could otherwise push hundreds of simultaneous
// requests into a single call; chunking keeps each batch reasonably sized
// while still fetching well ahead of one-file-at-a-time.
var FETCH_CHUNK_SIZE = 20;

// DriveApp.getFileById(id).getBlob() is a blocking round-trip per file, so
// fetching a screenshot and signature (or several records' worth, in bulk
// print) one at a time serializes N round-trips end to end. This issues
// them as batched UrlFetchApp.fetchAll() calls instead, which the Apps
// Script runtime executes concurrently, so total wait time is roughly the
// slowest single file in a batch instead of the sum of all of them.
//
// Returns an array the same length/order as fileIds. A null/blank id
// resolves to null (no file to fetch - normal for a row with nothing
// uploaded). A confirmed-missing file (404 from Drive, or DriveApp also
// throwing "not found") likewise resolves to null. Anything else - the
// whole fetchAll() batch throwing (e.g. a not-yet-granted OAuth scope right
// after this code first deploys), or an individual response coming back
// non-200/non-404 (permission hiccup, rate limiting, a transient 5xx) -
// first retries via the slower but dependable
// DriveApp.getFileById().getBlob(); if that *also* fails, this throws
// rather than quietly returning null, so a real Drive/permission problem
// surfaces as "could not load" instead of looking like the employee never
// uploaded a screenshot/signature.
function fetchFilesParallel_(fileIds) {
  var blobs = new Array(fileIds.length).fill(null);
  var idsToFetch = [];
  fileIds.forEach(function (id, i) {
    if (id) {
      idsToFetch.push(i);
    }
  });
  if (idsToFetch.length === 0) {
    return blobs;
  }

  var failedCount = 0;

  var token;
  try {
    token = ScriptApp.getOAuthToken();
  } catch (err) {
    idsToFetch.forEach(function (i) {
      var result = fetchFileViaDriveApp_(fileIds[i]);
      blobs[i] = result.blob;
      if (result.failed) {
        failedCount++;
      }
    });
    if (failedCount > 0) {
      throw new Error('Could not load ' + failedCount + ' file(s) from Drive.');
    }
    return blobs;
  }

  for (var start = 0; start < idsToFetch.length; start += FETCH_CHUNK_SIZE) {
    var chunkIndexes = idsToFetch.slice(start, start + FETCH_CHUNK_SIZE);
    var requests = chunkIndexes.map(function (i) {
      return {
        url: 'https://www.googleapis.com/drive/v3/files/' + fileIds[i] + '?alt=media',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      };
    });

    var responses;
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (err) {
      chunkIndexes.forEach(function (i) {
        var result = fetchFileViaDriveApp_(fileIds[i]);
        blobs[i] = result.blob;
        if (result.failed) {
          failedCount++;
        }
      });
      continue;
    }

    responses.forEach(function (response, j) {
      var i = chunkIndexes[j];
      var code = response.getResponseCode();
      if (code === 200) {
        blobs[i] = response.getBlob();
      } else if (code !== 404) {
        var result = fetchFileViaDriveApp_(fileIds[i]);
        blobs[i] = result.blob;
        if (result.failed) {
          failedCount++;
        }
      }
    });
  }

  if (failedCount > 0) {
    throw new Error('Could not load ' + failedCount + ' screenshot/signature file(s) from Drive - please retry.');
  }

  return blobs;
}

// Returns { blob, failed }. failed is true only when the file couldn't be
// fetched for a reason other than genuinely not existing (DriveApp throws
// the same way for "not found" as for real permission/Drive errors, so a
// message check is the only way to tell them apart).
function fetchFileViaDriveApp_(fileId) {
  try {
    return { blob: DriveApp.getFileById(fileId).getBlob(), failed: false };
  } catch (err) {
    var notFound = /not found/i.test(err.message || '');
    return { blob: null, failed: !notFound };
  }
}

function extractFileId_(url) {
  var match = String(url).match(/[-\w]{25,}/);
  return match ? match[0] : null;
}