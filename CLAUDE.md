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

## Deployment — already automated, do not tell the user to redeploy manually

`.github/workflows/deploy.yml` runs on every push to `main` that touches `apps-script/**`: it installs `clasp`, pushes the code, and runs `clasp deploy -i <DEPLOYMENT_ID>` to update the **existing** live Web App deployment. This has been verified working (checked via the GitHub Actions API — runs against this workflow show `conclusion: success` for recent commits touching `Code.gs`).

GitHub Pages separately auto-builds/deploys on every push to `main` (standard Pages behavior), which is what serves the root `index.html`/`admin.html` at `https://photolinepayroll.github.io/NoneATM/...`.

**Consequence:** editing and pushing `apps-script/Code.gs` is sufficient — the live backend updates itself within roughly a minute. `docs/DEPLOYMENT.md`'s "you must manually redeploy in the Apps Script editor" instructions predate this GitHub Action and are now outdated for changes made through this repo (they'd still apply if someone edited code directly in the Apps Script web editor instead of pushing here).

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
