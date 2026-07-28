# RESUME.md

Snapshot of where this project stands, for picking work back up in a future session. See `CLAUDE.md` for durable architecture/gotcha notes — this file is about *current state and open threads*, and will go stale faster.

## Current state (as of commit `e71e980`)

The admin dashboard (`admin.html`) and public enrollment form (`index.html`) are both live on GitHub Pages and functioning. Recent work, newest first:

- **Review-before-submit step added to the public form.** The submit button ("Submit" → "Review Submission") no longer posts immediately — it now shows a read-only review panel (entered fields, uploaded screenshot rendered inline for images / filename note for PDFs, and the drawn signature) with "Edit" (returns to the untouched form) or "Confirm & Submit" (does the actual POST, unchanged payload/logic, now reading from a `pendingSubmission` object captured at review time). Submission errors now surface in the review panel (`#err-review`) since the form is hidden by then.
- **"OWN account" emphasis added** to the screenshot upload field on the public form — label and hint text call out in bold/red that only the employee's *own* verified GCash account screenshot is accepted, not someone else's or an unverified one.
- **Admin login field relabeled** from "Passcode" to "Password" (user-facing text only — `id="passcode"`, the JS variable, the `gcashAdminPasscode` sessionStorage key, and the backend `ADMIN_PASSCODE` property are all unchanged).
- **Motion, icons, and transitions added across `admin.html`:** staggered row fade-in on every table render, skeleton shimmer rows while a fetch is in flight, a spinning refresh icon, pulsing stat cards on update, hover/press feedback on all buttons, a `prefers-reduced-motion` override, and outline SVG icons on every action button (paired with `.btn-label` spans so dynamic label text like "Print Selected (N)" doesn't clobber the icon).
- **"View / Print" and "Print Selected" now open in a new tab** (`window.open` with `?rowIndex=N` / `?rowIndexes=N,N,N` pointing back at `admin.html`) instead of navigating the dashboard tab away — preserves the dashboard's current filters/sort/page/selection. Reuses per-row/shared window names so re-clicking refocuses rather than duplicating tabs, pulls the passcode from sessionStorage (inherited by same-origin `window.open` tabs), and falls back to login-then-jump if there's no saved passcode. "Back to dashboard" is now just "Close" in both single-record and bulk-print views.
- **PDF screenshot embed removed from print output.** Chrome's built-in PDF viewer inside `<embed>`/`<object>` frequently fails to rasterize during print even though it displays fine on-screen, leaving a blank bordered box. A PDF-uploaded screenshot now renders nothing in the printed record (file is still stored/linked in the Sheet) — see gotcha #6 in `CLAUDE.md`.
- **Multi-select bulk printing added:** checkbox column + header "select all" on the dashboard table (selections persist across filter/sort/pagination via a `selectedRowIndexes` map), a "Print Selected (N)" button that fetches full detail for every selected row in parallel and renders each into its own full record card (cloned from `<template id="recordCardTemplate">`, inheriting the existing one-page print tuning), with `page-break-after: always` between cards so N selected records print as N pages.
- **Declaration wording updated** on both the form's checkbox and the printed record — two-paragraph "Employee Acknowledgment and Declaration" text with `Verified GCash Account` / `Photoline Enterprises Corporation` bolded.
- **Print typography enlarged** (logo, headings, fields, declaration text, signature); screenshot's allotted print space trimmed to compensate so the record still fits one page.
- **11-digit `09`-prefixed mobile number format enforced** end-to-end: form validation, server validation, and auto-correction on read for pre-existing Sheet rows that had lost their leading zero (see `CLAUDE.md`).
- **Admin dashboard additions:** Export to CSV (respects active filters, Excel-safe leading-zero formatting), sort by latest submission first, pagination at 50 rows/page, a Refresh button to re-fetch without re-login.
- **Print layout fully debugged** to a reliable one-page Letter/portrait layout including the GCash verification screenshot; root-cause writeup is in `CLAUDE.md` so it doesn't get relitigated.
- **Print button removed** in favor of a plain "Press Ctrl+P / Cmd+P" instruction, since `window.print()` was found to be silently blocked by OS/security software on at least one real test machine with no code-level fix possible.
- **GCash verification screenshot displays** in the admin record view and print output, labeled "Verified GCash Screenshot", centered.
- **Sample screenshot mockup added** to the public form's Section 2 (fictional "Juan Dela Cruz" example).

## Open threads / things not done

- **`apps-script/Index.html` and `apps-script/Admin.html` are out of sync** with the root `index.html`/`admin.html` — none of the changes above (review step, OWN-account emphasis, password relabel, admin motion/icons, new-tab print, bulk printing, screenshot display, CSV export, pagination, declaration wording, mobile number formatting, etc.) were ported there. This is an explicit, repeatedly-reaffirmed scope decision, not an oversight — but if the Apps-Script-native surface is ever actually used instead of the GitHub Pages one, it needs all of the above ported over.
- **`Gcash SAmple.png`** was previously noted as sitting untracked in the repo root, unused by any code. It's untracked, so it does not persist into fresh clones/sessions — this thread is effectively moot unless someone re-adds it locally and decides to commit it (e.g. into an `assets/` folder) or drop it for good.
- **No automated tests exist** for either the frontend or `Code.gs`. Verification has been manual (real browser testing via screenshots) plus `node --check` for JS syntax only.
- The printed record's one-page fit was tuned against *one specific test record's* screenshot image and declaration text length. If the declaration wording changes again, or a much taller/shorter screenshot is tested, re-check Ctrl+P print preview before assuming it still fits — the margin is comfortable but not huge (see the budget note in `CLAUDE.md`).
- The new review-before-submit step (`e71e980`) and the print-in-new-tab flow (`2b7790f`) are both notable behavior changes that haven't been called out as verified via live browser testing in the commit history the way earlier print-layout work was — worth a manual pass in a real browser if picking this up again, particularly the new-tab sessionStorage inheritance and the review panel's PDF-vs-image branching.

## Useful facts for a fresh session

- Live public form: `https://photolinepayroll.github.io/NoneATM/index.html`
- Live admin dashboard: `https://photolinepayroll.github.io/NoneATM/admin.html`
- Admin passcode is stored in the Apps Script project's Script Properties (`ADMIN_PASSCODE`), not in this repo.
- GitHub Actions (`.github/workflows/deploy.yml`) auto-deploys `apps-script/**` changes to the live Apps Script backend on every push to `main` — confirmed working via the Actions API, no manual redeploy step needed for changes made through this repo.
