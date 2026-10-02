# CLAUDE.md

Guidance for Claude Code (or any future contributor) working in this repository.

## What this project is

A GCash Payroll Enrollment system for **Photoline Enterprises Corporation**, for employees without an ATM savings account. Employees submit their own Verified GCash account (with a screenshot proof + e-signature) via a public form; HR reviews submissions through a passcode-gated admin dashboard. See `PROMPT.tx.txt` for the original field-by-field spec.

## Architecture — two parallel frontends, one backend

This repo contains **two separate copies** of the same UI, which is a source of confusion if you forget it exists:

| Surface | Files | Hosting | How it talks to the backend |
|---|---|---|---|
| Standalone (primary, actively maintained) | `index.html`, `admin.html` (repo root) | GitHub Pages, auto-deployed on every push to `main` | `fetch()` POST to the deployed Apps Script Web App URL (hardcoded `APPS_SCRIPT_URL` constant near the top of each file's `<script>`) |
| Apps-Script-native (secondary, **not kept in sync**) | `apps-script/Index.html`, `apps-script/Admin.html`, `apps-script/ClientScript.html`, `apps-script/Styles.html` | Served directly by the Apps Script web app itself (`doGet()` in `Code.gs`) | `google.script.run` / same-origin, templated via `HtmlService` |

**Important:** by explicit product decision (see git history / past sessions), UI work only happens on the root `index.html`/`admin.html`. The `apps-script/*.html` copies are legacy and have drifted — don't assume they match the root files, and don't update them unless specifically asked to.

The backend is **`apps-script/Code.gs`** — a single Google Apps Script file shared by both frontends. It:
- Writes submissions to a Google Sheet (`SHEET_ID` constant) and uploaded files to a Drive folder (`FOLDER_NAME` constant).
- Exposes `doPost` actions: `validatePasscode`, `listSubmissions`, `getSubmissionsFields`, `getSubmissionsMedia`, plus the implicit form-submit path (no `action` field at all — real enrollment submissions never send one, so `doPost` treats an unrecognized-but-present `action` as an error rather than falling through to `submitForm`). `getSubmissionDetail` still exists as a function but is no longer reachable via `doPost` — it's called directly via `google.script.run` only by the legacy `apps-script/Admin.html` surface. If a frontend copy ever calls a `doPost` action name that doesn't match one of the four above, it now gets a clear "Unknown action" error instead of a confusing wall of `validateSubmission_` "X is required" messages (that fallthrough bug is what happened when a stale local `admin.html` called the old `getSubmissionDetail` action after the backend had already moved to `getSubmissionsFields`/`getSubmissionsMedia` — see commit `f32b1b9`).
- Gates all admin actions behind `requireAdmin_(passcode)`, checked against a passcode stored in Script Properties (`ADMIN_PASSCODE`, set by running `setup()` once in the Apps Script editor).

## Deployment — already automated, do not tell the user to redeploy manually

`.github/workflows/deploy.yml` runs on every push to `main` that touches `apps-script/**`: it installs `clasp`, pushes the code, and runs `clasp deploy -i <DEPLOYMENT_ID>` to update the **existing** live Web App deployment. This has been verified working (checked via the GitHub Actions API — runs against this workflow show `conclusion: success` for recent commits touching `Code.gs`).

GitHub Pages separately auto-builds/deploys on every push to `main` (standard Pages behavior), which is what serves the root `index.html`/`admin.html` at `https://photolinepayroll.github.io/NoneATM/...`.

**Consequence:** editing and pushing `apps-script/Code.gs` is sufficient — the live backend updates itself within roughly a minute. `docs/DEPLOYMENT.md`'s "you must manually redeploy in the Apps Script editor" instructions predate this GitHub Action and are now outdated for changes made through this repo (they'd still apply if someone edited code directly in the Apps Script web editor instead of pushing here).

**Exception — adding a new OAuth scope requires one manual step the automated deploy can't do.** The web app runs as `executeAs: USER_DEPLOYING` ("Me"), so it executes with whatever scopes the deploying account has already consented to for this project. `clasp deploy` in the GitHub Action pushes code and republishes the deployment, but it does **not** re-trigger Google's OAuth consent screen — it can't grant a scope that was never approved. If a commit adds code that needs a scope the project hasn't used before (e.g. `UrlFetchApp` for the first time, needing `script.external_request`), every admin call touching that code path will start failing with an authorization error right after the automated deploy, even though the push itself succeeded. Fix: open the Apps Script editor for this project (script.google.com) as the deploying account, pick any function in the toolbar dropdown (e.g. `setup`), click **Run**, and approve the new permission in the consent dialog that appears — a one-time step, only needed the first time a given scope is introduced.

## Diagnosing "the admin dashboard is slow"

The Apps Script **Executions** log (Extensions → Apps Script → Executions in the editor) only measures server-side script run time — it does *not* include the network time to transfer the response back to the browser, or the time the browser spends decoding/rendering it. A `doPost` entry showing 1-2s "Duration" does not rule out the request feeling slow end-to-end.

Investigated once already (2026-07-28/29 session): every hypothesis involving the *backend* (missing OAuth scope for `UrlFetchApp` silently falling back to a slower path; stale deployed version) was checked against real Executions log data and ruled out — durations were consistently fast (under ~2.5s) with no errors, and the deployed Version's description confirmed it matched the latest push. The remaining, unconfirmed-but-likely suspect is **payload size**: the single-record "View" screen sends the screenshot at full original resolution as base64 (`admin.html`, `setScreenshotImage(...)` off `media.screenshotBase64`), while "Print Selected" (bulk) deliberately downscales screenshots first (`BULK_SCREENSHOT_MAX_DIMENSION = 1000`, JPEG quality 0.8, via `downscaleDataUrl()`) specifically because the untouched original was too heavy. Single-record view never got the same treatment, plausibly on purpose (to keep Ctrl+P print quality high) — but if so, that tradeoff was never revisited even after the bulk path proved it was a real problem.

**Update 2026-10-02 (commit `5934ab8`):** the payload-size theory was acted on without a Network-tab measurement. `getSubmissionsMedia` now requests Drive thumbnails (`sz=w1400`, falls back to the original on any non-200); `viewDetail` renders from the cached list row and only fetches media; media is cached in-memory per row; `listSubmissions` cache is 600s and chunked across keys (`listSubmissions_v2`, pointer + `<key>_<id>_<i>` chunks) because a single key silently failed past 100KB; reloads show the `sessionStorage` list (`gcashAdminList`) first, only for an already-validated session passcode. The thumbnail endpoint was not tested live before shipping - if the screenshot is still slow, check whether it is silently falling back to full size.

If asked to speed up the dashboard again: don't re-litigate the OAuth-scope/backend theory without first checking the Executions log durations directly. Instead check the browser's Network tab for the actual request size/time on a "View" click, and consider that any real fix likely has to reconcile "fast preview" against "the print output still needs to look good" rather than just copying the bulk downscale approach wholesale.

## Data model gotcha: mobile numbers

`Sheet.appendRow()` writes plain JS strings, and Google Sheets auto-detects number-looking text and silently converts it to a numeric cell — **dropping the leading zero** from PH mobile numbers (e.g. `09171234567` becomes `9171234567`). Two-part fix already in place in `Code.gs`:
- `sanitizeMobileForSheet_()` force-prefixes new writes with `'` so Sheets stores them as text.
- `normalizeMobileNumber_()` re-pads any already-corrupted 10-digit value back to 11 digits when read (`listSubmissions`, `getSubmissionDetail`). Since the admin table, CSV export, and printed record all read through these two functions, fixing normalization at the source fixes all three displays at once — don't duplicate padding logic in the frontend.

Both `index.html` (client-side) and `Code.gs`'s `validateSubmission_` (server-side) enforce the `^09\d{9}$` pattern (11 digits, starts with `09`) on new submissions.

**Same class of bug hit `birthday`** when it was added (2026-08-17/18 session): Sheets also auto-detects date-looking strings and converts them to a Date-typed cell, which would have round-tripped through `JSON.stringify()` as a full ISO datetime instead of the plain `yyyy-mm-dd` the date picker sends. Fixed the same way as mobile numbers — `submitForm` writes it as `"'" + sanitizeForSheet_(formData.birthday)` to force text storage (`Code.gs`, inside the `appendRow` call). If any other date-shaped field is ever added, apply the same leading-`'` treatment at write time rather than rediscovering this.

## Sheet schema (`SHEET_HEADERS`, 13 columns)

`Timestamp, Employee Name, First Name, Middle Name, Last Name, Birthday, City/Province, Branch/Department, Contact Number, Verified GCash Mobile Number, Declaration Accepted, GCash Screenshot Link, Signature Link`.

The public form (`index.html`) collects First/Middle/Last Name (Middle optional) instead of a single Employee Name field, plus Birthday (date picker) and City/Province — both required. `Code.gs` keeps the "Employee Name" column and auto-populates it by joining the three name parts (`firstName + ' ' + middleName + ' ' + lastName`, skipping a blank middle name) on every submission, so anything that already reads that column (admin search, CSV export, the printed record's signature line, the Drive attachment filenames) keeps working unchanged. `admin.html`'s detail view, printed record, and CSV export show Birthday/City-Province as additional fields; the summary table intentionally does not gain new columns for them (deliberate scope decision, not an oversight).

Every function in `Code.gs` that reads a row by raw numeric index (`listSubmissions`, `getSubmissionsFields`, `getSubmissionsMedia`, the legacy `getSubmissionDetail`) has to agree with `SHEET_HEADERS`'s column order — there's no named-index abstraction, just literal `row[N]` throughout, so a future schema change means touching every one of those functions and rechecking the map by hand (this was the highest-risk part of implementing the split; see the code-quality review this session flagged the lack of a `COLUMN` constant as a standing risk for the *next* change, not a defect in this one).

**Migrating an already-populated Sheet to a new column layout is not just a code change.** When the 5 new columns were inserted after "Employee Name" (rather than appended at the very end), the live Sheet needed a one-time manual "Insert N columns left" to physically shift existing data before the new code's column indices would line up with it — done immediately before pushing, since there's an unavoidable ~1 minute window (the Apps Script deploy time) where old data position and new code expectations could briefly mismatch. If the column layout changes again, budget for this same manual step, timed with the push, not after it.

## Print/PDF layout gotchas (admin.html record view)

The printed enrollment record (`#detailSection` → `.admin-card` in `admin.html`) went through many iterations to fit on one Letter page. Lessons learned, so they aren't relearned the hard way:

1. **`hidden` attribute + an unconditional `display: block` rule on the same class = the element is never actually hidden.** A CSS author-stylesheet rule with normal priority always overrides the browser's default `[hidden] { display: none }` UA rule, regardless of specificity. If a class needs to respect `[hidden]`, scope the `display` declaration as `.foo:not([hidden]) { display: block; }`, not `.foo { display: block; }`. (This was the actual root cause of a phantom empty box that survived three unrelated "shrink the fonts" fix attempts — see commit `5650a00`.)
2. **CSS `zoom` is unreliable for Chrome's print pagination.** It visually scales content, but Chrome appears to compute page-break decisions against the pre-zoom layout size, so content can still overflow to a near-empty second page. Use real box-model properties (`font-size`, `padding`, `margin`, `max-height` in `px`) for anything that must respect a page boundary — see commit `fe1ff03`.
3. **`page-break-inside: avoid` on a block containing an `<img>` constrained only by `max-height` can still get bumped as a whole to the next page**, even when the rendered (constrained) size would clearly fit in the remaining space — Chrome seems to sometimes reserve space based on the image's original/intrinsic dimensions for the break decision. Fix: give the *container* itself an explicit `max-height` + `overflow: hidden` (not just the descendant image) so pagination has a concrete box to evaluate — see commit `f0d98e1`.
4. **`window.print()` can be silently blocked by OS/security software on some machines** while the native Ctrl+P/Cmd+P shortcut still works fine on the exact same page — confirmed via a from-scratch minimal test page with zero other code that failed identically. There is no reliable client-side way to detect this (browsers give scripts no feedback on whether a print dialog opened). The Print button was removed entirely in favor of a plain on-page instruction to press Ctrl+P/Cmd+P (commit `4439e9a`).
5. **`file://` URLs break scripted `window.print()`** in Chrome with a console error like `Unsafe attempt to load URL file:///... 'file:' URLs are treated as unique security origins` — printing requires the page be served over `http(s)://` (GitHub Pages URL, or a local dev server). This is separate from gotcha #4.
6. **An `<embed type="application/pdf">` used to preview a PDF-format screenshot prints as an empty bordered box.** Chrome's built-in PDF viewer plugin inside an `<embed>`/`<object>` frequently fails to rasterize during print/print-to-PDF even though it displays fine on-screen. There's no known reliable fix for inline PDF printing this way — it was removed entirely (commit `517117d`); a PDF-uploaded screenshot now just shows nothing in the printed record instead of a broken box (the file is still stored/linked in the Sheet).

If asked to touch the print layout again, budget roughly: Letter page minus 0.5in margins ≈ 960px usable height at 96dpi; current per-element sizes are tuned to fit comfortably under that with the screenshot included — check current `@media print` values in `admin.html` before changing them blind.

## Conventions observed in this codebase

- No build step — `index.html` and `admin.html` are single self-contained files (inline `<style>`/`<script>`, base64-embedded logo). Editing them means editing one big file; use `grep`/line-number lookups rather than reading the whole file (the embedded base64 logo makes naive full-file reads blow past tool size limits).
- Validate any JS edits with `node --check` on the extracted `<script>` block before committing — there's no test suite or linter wired up.
- Commit messages in this repo tend to be detailed (a summary line plus a body explaining *why*, especially for bug fixes) — match that style rather than one-line messages.
- `Gcash SAmple.png` sits untracked in the repo root (not referenced by any code) — it was an example image dropped in during a chat session; it's not part of the app.
