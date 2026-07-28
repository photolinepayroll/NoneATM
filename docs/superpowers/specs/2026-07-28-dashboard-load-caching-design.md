# Admin dashboard load/Refresh caching — design

## Problem

The admin dashboard's initial load and its Refresh button both call the backend
`listSubmissions` action, which does a full `Sheet.getRange(...).getValues()`
read of every submission row on every single call. Filtering, sorting, and
pagination all happen client-side over that full row set (see `RESUME.md`), so
the backend has no way to serve a partial result today. As the Sheet
accumulates more enrollments over time, this read (plus the per-row date
formatting done in a JS loop) gets slower, and it's paid again on every
Refresh click even when nothing has actually changed since the last one —
which is the common case for an admin re-checking the dashboard.

## Goals

- Make repeated Refresh clicks (no new data since last load) fast — ideally
  near-instant.
- A newly submitted enrollment should still show up on the very next Refresh
  after it's submitted, not be hidden behind a staleness window.
- No behavior change to filtering/sorting/pagination, and no new failure mode:
  if caching can't apply for any reason, `listSubmissions` must fall back to
  today's exact behavior (a live Sheet read), never a hard error.

## Non-goals

- Server-side filtering/pagination (would reduce payload size further but is
  a larger, separate change to both `Code.gs` and `admin.html`).
- Speeding up the very first cold load when the cache is empty and the Sheet
  is large — this design does not change the cost of that one read.
- Any change to `getSubmissionsFields`/`getSubmissionsMedia` (the View/Print
  paths) — those were addressed in prior work and are out of scope here.

## Design

### Backend (`apps-script/Code.gs`)

Add a fixed cache key, e.g. `LIST_SUBMISSIONS_CACHE_KEY = 'listSubmissions_v1'`,
and a TTL constant, e.g. `LIST_SUBMISSIONS_CACHE_TTL_SECONDS = 30`.

**`listSubmissions(passcode)`:**
1. `requireAdmin_(passcode)` as today.
2. Try `CacheService.getScriptCache().get(LIST_SUBMISSIONS_CACHE_KEY)`. If
   present, `JSON.parse` it and return directly — no Sheet read at all.
3. On a miss, compute the result exactly as today (one `getRange().getValues()`
   call, per-row formatting), but build the per-row `Date` object once and
   reuse it for both `timestamp` and `timestampIso` (currently constructed
   twice) instead of adding new formatting work.
4. Before returning, attempt to
   `cache.put(LIST_SUBMISSIONS_CACHE_KEY, JSON.stringify(result), LIST_SUBMISSIONS_CACHE_TTL_SECONDS)`
   inside a `try/catch`. `CacheService` rejects values over 100KB per key; if
   that throws (Sheet has grown large enough that the JSON exceeds it), swallow
   the error and just skip caching for this call — every future call simply
   falls back to a live read, matching today's behavior exactly, no user-visible
   error.

**`submitForm(formData)`:**
- Immediately after the existing `sheet.appendRow([...])` call succeeds, call
  `CacheService.getScriptCache().remove(LIST_SUBMISSIONS_CACHE_KEY)`.
- This means the 30s TTL is a safety net, not the real staleness bound: a
  submission always invalidates the cache the moment it lands, so the very
  next `listSubmissions` call (from any admin, immediately or otherwise) does
  a fresh read and repopulates the cache. The only staleness an admin can
  ever actually observe is "someone else's Refresh within the last 30s of
  another Refresh with no new submissions in between" — which is exactly the
  case this change intends to make fast.

### Frontend (`admin.html`)

No changes. `refreshSubmissions()`/`listSubmissions` call shape and response
shape are unchanged; caching is entirely a backend implementation detail.

### Error handling

- Cache read/parse failure (corrupted/unexpected cache value): wrap the cache
  read in `try/catch` too, treat any failure as a cache miss and fall through
  to a live read — never let a cache problem surface as a broken dashboard.
- Cache write failure (oversized payload, or any other `CacheService` error):
  caught and ignored, as above.
- Nothing about `requireAdmin_`'s passcode check changes — caching only
  applies to the already-authorized data fetch, not to auth itself (each
  call still re-validates the passcode before touching the cache).

### Testing

- `node --check` on the extracted `Code.gs`/`admin.html` script blocks (no
  test suite exists in this repo — see `CLAUDE.md` conventions).
- Manual verification after deploy: confirm two consecutive Refresh clicks
  return the same data quickly, and confirm a new submission appears on the
  first Refresh after submitting.
