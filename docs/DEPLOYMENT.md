# Deploying the GCash Payroll Enrollment Form

1. Go to https://script.google.com and click "New project". (Use a standalone
   project, not one bound to an existing Sheet — `setup()` creates the Sheet
   for you, and a bound script's container Sheet would just be an unused
   duplicate.)
2. Rename the project (top left) to "GCash Payroll Enrollment Form".
3. In the file list, delete the default empty `Code.gs` content and paste in
   the contents of `apps-script/Code.gs` from this folder.
4. Click the "+" next to Files → HTML, name it `Index`. Apps Script fills
   the new file with boilerplate placeholder HTML — delete all of it, then
   paste in the contents of `apps-script/Index.html`.
5. Repeat for `Styles` (HTML) and `ClientScript` (HTML): create each file,
   delete its boilerplate placeholder content, then paste in
   `apps-script/Styles.html` and `apps-script/ClientScript.html`
   respectively.
6. Click the gear icon (Project Settings) → check "Show `appsscript.json`
   manifest file in editor" → open `appsscript.json` → replace its contents
   with `apps-script/appsscript.json`.
7. Select `setup` from the function dropdown at the top, click "Run". The
   first run will prompt you to authorize the script (it needs Sheets and
   Drive access). Because this is your own private script, Google will show
   a "Google hasn't verified this app" warning screen first — this is
   expected and normal for scripts you write yourself, not a sign anything
   is wrong. Click "Advanced", then click "Go to [project name] (unsafe)",
   then review the permissions and click "Allow".
8. Check the execution log (View → Logs) for the two URLs it printed. Open
   both to confirm the Sheet "Photoline GCash Payroll Enrollment Responses"
   and the folder "GCash Payroll Enrollment Attachments" now exist in your
   Drive.
9. Click "Deploy" → "New deployment" → gear icon → "Web app".
   - Description: "GCash Payroll Enrollment Form v1"
   - Execute as: **Me**
   - Who has access: **Anyone within [your Workspace domain]** if all
     employees have a company Google account, otherwise **Anyone** if some
     employees don't.
10. Click "Deploy", authorize again if prompted, and copy the Web App URL.
11. Open that URL on a phone to confirm it works before sharing it further:
    - The page loads with the Photoline/GCash logo visible and all 4
      sections visible when scrolling.
    - Leave every field empty and tap Submit — you should see an inline
      error under each required field, and nothing should be saved.
    - Fill in all fields, upload a real image under 10MB, check the
      declaration box, draw a signature, and tap Submit — you should see
      the exact "Thank you!" confirmation message, and a new row should
      appear in the "Photoline GCash Payroll Enrollment Responses" sheet
      with working links to both the uploaded screenshot and the signature
      image in the "GCash Payroll Enrollment Attachments" folder.
    - Try selecting an oversized or wrong-type file (e.g. a .docx) in the
      screenshot field — it should be rejected immediately with an inline
      error, not silently accepted.
12. Share the Web App URL with employees (e.g. via HR announcement, group
    chat, or a QR code pointing to it).

## Updating the form later

Any time you edit the code in the Apps Script editor, changes only take
effect for the deployed Web App after you go to Deploy → "Manage
deployments" → edit the existing deployment → New version → Deploy. Editing
the files alone does not update the live URL.
