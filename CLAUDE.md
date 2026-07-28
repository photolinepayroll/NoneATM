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
- Exposes `doPost` actions: `listSubmissions`, `getSubmissionDetail`, `saveVerificationReport` (if present), plus the implicit form-submit path.
- Gates all admin actions behind `requireAdmin_(passcode)`, checked against a passcode stored in Script Properties (`ADMIN_PASSCODE`, set by running `setup()` once in the Apps Script editor).

## Apps Script Web App exec/echo redirect is slow and sometimes fails outright

Every `doPost`/`doGet` call to the deployed exec URL is a two-hop request: `script.google.com/.../exec` returns a 302 redirect to `script.googleusercontent.com/macros/echo?user_content_key=...`, and that second hop actually delivers the response. Confirmed via the browser Network tab in a live debugging session: the first hop is fast (~1s), but the second hop has been observed taking 6-10+ seconds and returning a **404** outright, or stalling past 30 seconds with no response at all. This isn't network/firewall-specific — it reproduced consistently in the same browser/network across multiple attempts — and it's the root cause of three separate symptoms chased in one session: intermittent "Unexpected token '<', <!DOCTYPE" errors (an HTML error page instead of JSON), a hard CORB block when a same-origin-adjacent JSONP `<script>` tag approach was tried instead of `fetch()` (reverted — see git history around "Switch admin.html data calls from fetch() POST to JSONP GET" / its revert commit), and 30+ second hangs on every single admin action including cache-hit calls that do almost no script-side work.

Mitigations in place, in order of where they apply:
- `admin.html`'s `callBackend()` wraps every call in a 12-second `AbortController` timeout with up to 2 retries (fresh connection each time) - recovers from transient stalls, doesn't fix the underlying redirect reliability.
- The admin dashboard's **list view** doesn't call Apps Script at all - see the "PublicList sheet" section below. This is the only view that fully sidesteps the exec/echo redirect; everything reached via View/Print/Export still pays this cost.
- Do not re-attempt a JSONP/`<script>`-tag approach as a fix for this - it trades an intermittent failure for a deterministic CORB block in Chrome, confirmed live.

## PublicList sheet — the safe, fast path for the admin list view

`Code.gs` maintains a second sheet tab, **`PublicList`** (name/branch/timestamp only - no mobile numbers, no file links), kept in lockstep with the main data sheet: `appendToPublicList_()` is called right after every `submitForm()` append, and `rebuildPublicList_()` (called from `setup()`) fully rebuilds it from the main sheet, so it's safe to re-run and also backfills anything that existed before this feature did. Row N in `PublicList` always corresponds to row N in the main sheet — both are strictly append-only, in the same order, never independently sorted/filtered/deleted — so a `rowIndex` read from `PublicList` can be passed straight into `getSubmissionsFields`/`getSubmissionsMedia`.

This sheet is published to the web (File → Share → Publish to web → select the `PublicList` sheet specifically, not the whole document → CSV format), which serves it as a static file directly from Google Sheets infrastructure — no Apps Script execution, no exec/echo redirect, loads instantly. `admin.html`'s `PUBLIC_LIST_CSV_URL` constant points at that published URL and `loadPublicPreview()` fetches/parses it client-side to render the dashboard's initial table (with a "View / Print" button per row that opens the existing gated `?rowIndex=` flow), with zero passcode required for that initial view.

**Deliberately excluded from `PublicList` and this whole public path:** mobile numbers (`Contact Number`, `Verified GCash Mobile Number`), the GCash screenshot, and the e-signature. This was an explicit, discussed decision — those fields are financial-account-linked PII for real, named employees, publishing them without consent is a Data Privacy Act (RA 10173) concern for Photoline, not just a technical trade-off. They remain reachable only through `getSubmissionsFields`/`getSubmissionsMedia`, still fully gated behind `requireAdmin_(passcode)` exactly as before. Do not widen what's mirrored into `PublicList` without the same explicit conversation.

**One-time manual steps whenever `PublicList` needs (re)publishing** (can't be automated via `clasp deploy` or any Apps Script API — Google has no API for "Publish to web"):
1. Run `setup()` once in the Apps Script editor (creates/backfills the `PublicList` tab).
2. In the Google Sheet: File → Share → Publish to web → select `PublicList` (not "Entire Document") → CSV → Publish → copy the resulting URL.
3. Paste that URL into `PUBLIC_LIST_CSV_URL` in `admin.html` and push.

## Deployment — already automated, do not tell the user to redeploy manually

`.github/workflows/deploy.yml` runs on every push to `main` that touches `apps-script/**`: it installs `clasp`, pushes the code, and runs `clasp deploy -i <DEPLOYMENT_ID>` to update the **existing** live Web App deployment. This has been verified working (checked via the GitHub Actions API — runs against this workflow show `conclusion: success` for recent commits touching `Code.gs`).

GitHub Pages separately auto-builds/deploys on every push to `main` (standard Pages behavior), which is what serves the root `index.html`/`admin.html` at `https://photolinepayroll.github.io/NoneATM/...`.

**Consequence:** editing and pushing `apps-script/Code.gs` is sufficient — the live backend updates itself within roughly a minute. `docs/DEPLOYMENT.md`'s "you must manually redeploy in the Apps Script editor" instructions predate this GitHub Action and are now outdated for changes made through this repo (they'd still apply if someone edited code directly in the Apps Script web editor instead of pushing here).

**Exception — adding a new OAuth scope requires one manual step the automated deploy can't do.** The web app runs as `executeAs: USER_DEPLOYING` ("Me"), so it executes with whatever scopes the deploying account has already consented to for this project. `clasp deploy` in the GitHub Action pushes code and republishes the deployment, but it does **not** re-trigger Google's OAuth consent screen — it can't grant a scope that was never approved. If a commit adds code that needs a scope the project hasn't used before (e.g. `UrlFetchApp` for the first time, needing `script.external_request`), every admin call touching that code path will start failing with an authorization error right after the automated deploy, even though the push itself succeeded. Fix: open the Apps Script editor for this project (script.google.com) as the deploying account, pick any function in the toolbar dropdown (e.g. `setup`), click **Run**, and approve the new permission in the consent dialog that appears — a one-time step, only needed the first time a given scope is introduced.

## Data model gotcha: mobile numbers

`Sheet.appendRow()` writes plain JS strings, and Google Sheets auto-detects number-looking text and silently converts it to a numeric cell — **dropping the leading zero** from PH mobile numbers (e.g. `09171234567` becomes `9171234567`). Two-part fix already in place in `Code.gs`:
- `sanitizeMobileForSheet_()` force-prefixes new writes with `'` so Sheets stores them as text.
- `normalizeMobileNumber_()` re-pads any already-corrupted 10-digit value back to 11 digits when read (`listSubmissions`, `getSubmissionDetail`). Since the admin table, CSV export, and printed record all read through these two functions, fixing normalization at the source fixes all three displays at once — don't duplicate padding logic in the frontend.

Both `index.html` (client-side) and `Code.gs`'s `validateSubmission_` (server-side) enforce the `^09\d{9}$` pattern (11 digits, starts with `09`) on new submissions.

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
