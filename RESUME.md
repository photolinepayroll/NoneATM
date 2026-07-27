# RESUME.md

Snapshot of where this project stands, for picking work back up in a future session. See `CLAUDE.md` for durable architecture/gotcha notes — this file is about *current state and open threads*, and will go stale faster.

## Current state (as of commit `0880f21`)

The admin dashboard (`admin.html`) and public enrollment form (`index.html`) are both live on GitHub Pages and functioning. Recent work in this session, newest first:

- **Declaration wording updated** on both the form's checkbox and the printed record — new two-paragraph "Employee Acknowledgment and Declaration" text with `Verified GCash Account` / `Photoline Enterprises Corporation` bolded.
- **Print typography enlarged** (logo, headings, fields, declaration text, signature) after the one-page-fit work below made everything too small to read comfortably. Screenshot's allotted print space was trimmed to compensate for the longer declaration text so the record still fits one page.
- **11-digit `09`-prefixed mobile number format enforced** end-to-end: form validation, server validation, and a fix for a real data bug where Google Sheets had silently stripped the leading zero from existing rows (now auto-corrected on read; see `CLAUDE.md`).
- **Admin dashboard additions:** Export to CSV (respects active filters, Excel-safe leading-zero formatting), sort by latest submission first, pagination at 50 rows/page.
- **Print layout fully debugged** — went through several wrong turns (zoom scaling, per-element font guesses, a genuine CSS bug where a "hidden" screenshot embed was never actually hidden) before landing on a reliable one-page Letter/portrait layout with the GCash verification screenshot included. Full root-cause writeup is in `CLAUDE.md` so it doesn't get relitigated.
- **Print button removed.** `window.print()` was found to be silently blocked by something OS/security-level on at least one real test machine, with no code-level fix possible or detectable. Replaced with a plain "Press Ctrl+P / Cmd+P" instruction, which worked reliably in testing.
- **GCash verification screenshot now displays** in the admin record view and print output (it didn't before this session, despite the backend already fetching it) — labeled "Verified GCash Screenshot", centered.
- **Sample screenshot mockup added** to the public form's Section 2, showing employees what a valid verification screenshot should contain (fictional "Juan Dela Cruz" example, not a real account).
- **Refresh button** added to the admin dashboard topbar to re-fetch submissions without re-login.

## Open threads / things not done

- **`apps-script/Index.html` and `apps-script/Admin.html` are out of sync** with the root `index.html`/`admin.html` — none of this session's changes (screenshot display, CSV export, pagination, declaration wording, mobile number formatting, etc.) were ported there. This was an explicit scope decision each time it came up, not an oversight — but if the Apps-Script-native surface is ever actually used instead of the GitHub Pages one, it needs all of the above ported over.
- **`Gcash SAmple.png`** sits untracked in the repo root, unused by any code. Never resolved whether to add it somewhere (e.g. an `assets/` folder) or delete it.
- **No automated tests exist** for either the frontend or `Code.gs`. Verification this session was manual (real browser testing via screenshots) plus `node --check` for JS syntax only.
- The printed record's one-page fit was tuned against *one specific test record's* screenshot image and declaration text length. If the declaration wording changes again, or a much taller/shorter screenshot is tested, re-check Ctrl+P print preview before assuming it still fits — the margin is comfortable but not huge (see the budget note in `CLAUDE.md`).

## Useful facts for a fresh session

- Live public form: `https://photolinepayroll.github.io/NoneATM/index.html`
- Live admin dashboard: `https://photolinepayroll.github.io/NoneATM/admin.html`
- Admin passcode is stored in the Apps Script project's Script Properties (`ADMIN_PASSCODE`), not in this repo.
- GitHub Actions (`.github/workflows/deploy.yml`) auto-deploys `apps-script/**` changes to the live Apps Script backend on every push to `main` — confirmed working via the Actions API, no manual redeploy step needed for changes made through this repo.
