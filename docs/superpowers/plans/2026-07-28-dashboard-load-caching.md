# Dashboard Load/Refresh Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin dashboard's `listSubmissions` backend call return instantly on repeat Refresh clicks, without ever showing stale data for a submission that landed since the last call.

**Architecture:** `listSubmissions` reads through a `CacheService.getScriptCache()` entry (30s TTL) instead of always hitting the Sheet; `submitForm` proactively clears that same cache entry right after a successful `appendRow`, so a new submission is visible on the very next `listSubmissions` call regardless of the TTL. All cache read/write paths fail open (silently fall back to a live Sheet read) so a `CacheService` problem can never break the dashboard or form submission.

**Tech Stack:** Google Apps Script (`apps-script/Code.gs`), `CacheService` (built-in Apps Script service, no new dependency).

**Spec:** `docs/superpowers/specs/2026-07-28-dashboard-load-caching-design.md`

---

## Repo conventions this plan follows

- No test suite or linter exists in this repo (see `CLAUDE.md`). Validation is `node --check` on the file (Apps Script's `.gs` syntax is plain JS-compatible for this purpose) plus a manual post-deploy check — this plan uses that same pattern instead of inventing a test framework.
- `apps-script/Code.gs` deploys automatically on push to `main` via `.github/workflows/deploy.yml` (confirmed working in `CLAUDE.md`) — no manual redeploy step needed. This change introduces no new OAuth scope (`CacheService` needs none beyond what the script already has), so unlike the earlier `UrlFetchApp` change, no manual re-authorization step is needed here.
- Commit message style in this repo is a summary line + a body explaining *why* — match that, not one-liners.

---

### Task 1: Cache constants, cache helpers, and read-through caching in `listSubmissions`

**Files:**
- Modify: `apps-script/Code.gs:13-14` (add constants), `apps-script/Code.gs:246-267` (rewrite `listSubmissions`, add 3 new helper functions after it)

- [ ] **Step 1: Add the two cache constants**

In `apps-script/Code.gs`, find:

```js
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
```

Replace with:

```js
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const LIST_SUBMISSIONS_CACHE_KEY = 'listSubmissions_v1';
const LIST_SUBMISSIONS_CACHE_TTL_SECONDS = 30;
```

- [ ] **Step 2: Rewrite `listSubmissions` to read through the cache, and add the three cache helper functions**

Find the current function:

```js
function listSubmissions(passcode) {
  requireAdmin_(passcode);
  var sheet = getSheet_();
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
```

Replace with:

```js
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
```

- [ ] **Step 3: Syntax-check the file**

Run:

```bash
cp apps-script/Code.gs /tmp/code-check.js && node --check /tmp/code-check.js && echo OK
```

Expected: `OK` printed, no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add apps-script/Code.gs
git commit -m "$(cat <<'EOF'
Cache listSubmissions response to speed up repeat dashboard Refresh

listSubmissions read the whole Sheet on every single call, even when
an admin just clicked Refresh a moment ago with nothing new to show -
the common case. It now reads through a 30s CacheService entry first;
a cache miss falls back to exactly the same Sheet read as before and
repopulates the cache. Both the cache read and write are wrapped so
any CacheService problem (corrupted value, payload over the 100KB
per-key limit once the Sheet has grown enough) silently degrades to
today's always-read-the-Sheet behavior rather than breaking the
dashboard. Also reuses one Date object per row for both timestamp
formats instead of constructing it twice.

invalidateListSubmissionsCache_ is added here but not called yet -
wired up to submitForm in the next commit so a fresh submission still
appears on the very next Refresh regardless of the TTL.
EOF
)"
```

---

### Task 2: Invalidate the cache on new submission

**Files:**
- Modify: `apps-script/Code.gs:149-158` (inside `submitForm`)

- [ ] **Step 1: Call the invalidation helper right after a successful `appendRow`**

Find, inside `submitForm`:

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
  } catch (e) {
```

Replace with:

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
    invalidateListSubmissionsCache_();
  } catch (e) {
```

(This call is placed inside the `try` block, after `appendRow`, so it only fires when the row was actually written - not on a validation or upload failure that ends up in the `catch` block below it.)

- [ ] **Step 2: Syntax-check the file**

Run:

```bash
cp apps-script/Code.gs /tmp/code-check.js && node --check /tmp/code-check.js && echo OK
```

Expected: `OK` printed, no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add apps-script/Code.gs
git commit -m "$(cat <<'EOF'
Invalidate the listSubmissions cache when a new submission is recorded

Completes the caching added in the previous commit: without this, a
brand-new enrollment would be invisible to every admin's dashboard
until the 30s cache TTL happened to expire. Calling
invalidateListSubmissionsCache_() right after appendRow succeeds means
the very next listSubmissions call - from any admin, immediately after
submission - does a fresh Sheet read and repopulates the cache, so the
TTL only ever matters between repeat Refresh clicks with no new
submissions in between.
EOF
)"
```

---

### Task 3: Deploy verification

**Files:** none (verification only)

- [ ] **Step 1: Push and confirm the automated deploy succeeds**

```bash
git push origin claude/resume-files-kkn7f4:main
git push -u origin claude/resume-files-kkn7f4
```

Then check the `deploy.yml` GitHub Actions run for the new commit shows `conclusion: success` (via the GitHub Actions API/UI) before considering this done - `Code.gs` changes only take effect once that workflow completes.

- [ ] **Step 2: Manually verify cache behavior on the live admin dashboard**

1. Open the admin dashboard, log in, note how long the initial load/Refresh takes.
2. Click Refresh again immediately - it should visibly return faster than the first load (served from cache, no Sheet read).
3. Submit a new test enrollment through the public form.
4. Click Refresh on the admin dashboard right away - the new submission must appear immediately (proves `invalidateListSubmissionsCache_` fired), not be missing until ~30s pass.

If step 4 fails (new submission doesn't appear until a delay), the invalidation call is not wired up correctly - re-check Task 2, Step 1's placement (it must be inside the `try` block, after `appendRow`, not after the whole `try/catch`).

---

### Task 4: Update `RESUME.md`

**Files:**
- Modify: `RESUME.md`

- [ ] **Step 1: Add a bullet documenting this change**

In `RESUME.md`, find the line:

```
## Current state (as of commit `a7bde1a`)
```

Replace the commit hash in that header with the final commit hash from Task 2 (get it via `git log --oneline -1`), and add this as the new first bullet under "Recent work, newest first" (immediately after the `## Current state...` line and its intro paragraph, before the existing first bullet):

```markdown
- **Admin dashboard Refresh sped up via backend caching.** `listSubmissions` (`Code.gs`) now reads through a 30-second `CacheService` entry instead of hitting the Sheet on every call, so repeat Refresh clicks with nothing new to show return near-instantly. `submitForm` proactively clears that cache entry right after a successful `appendRow`, so a brand-new submission still appears on the very next Refresh regardless of the TTL - the cache only actually matters between repeat Refreshes with no new data in between. Both the cache read and write paths fail open (fall back to a live Sheet read) if `CacheService` has any problem, including once the Sheet grows past the 100KB-per-key cache size limit.
```

- [ ] **Step 2: Commit**

```bash
git add RESUME.md
git commit -m "$(cat <<'EOF'
Document dashboard-caching change in RESUME.md

Keeps the session snapshot current per this repo's convention of
recording what changed and why for whoever picks this up next.
EOF
)"
git push origin claude/resume-files-kkn7f4:main
git push -u origin claude/resume-files-kkn7f4
```

---

## Self-review notes

- **Spec coverage:** cache key/TTL constants (Task 1), read-through cache with parse-failure fallback (Task 1), write-through invalidation from `submitForm` (Task 2), oversized-payload fallback (Task 1's `setCachedListSubmissions_`), reused `Date` object (Task 1), no frontend changes (none made), manual verification of both the speedup and the freshness guarantee (Task 3). All spec sections are covered.
- **Type/name consistency:** `LIST_SUBMISSIONS_CACHE_KEY` and `LIST_SUBMISSIONS_CACHE_TTL_SECONDS` are defined once in Task 1 and referenced with the same names in `getCachedListSubmissions_`/`setCachedListSubmissions_`/`invalidateListSubmissionsCache_`; `invalidateListSubmissionsCache_` is defined in Task 1 and called with that exact name in Task 2 - no drift.
- **No placeholders:** every step shows the literal before/after code or the literal command to run.
