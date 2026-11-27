# AnbuExam

Static exam shell (HTML/CSS/JS) for GitHub + Cloudflare Pages, with a one-time Google Apps Script backend.
Admin uploads a question file, gets an exam link. No `script.js` edits, no new Apps Script per exam.

## One-time setup (never repeated)
1. **Backend.** Go to script.google.com > New project. Paste `Code.gs`. Change `ADMIN_KEY` to your own secret.
   Run `setup()` once and authorise. Then **Deploy > New deployment > Web app**: Execute as *Me*, Access *Anyone*. Copy the `/exec` URL.
2. **Frontend.** Paste that URL into `config.js` (`const API_URL = '...';`). Push all files to GitHub; Cloudflare redeploys.
   If you ever edit `Code.gs` later, use *Deploy > Manage deployments > Edit > New version* (the URL stays the same).

## Every new exam (no code)
1. Open `admin.html`, enter the admin key.
2. Download a template (XML, CSV or JSON), fill in questions, upload it.
3. Set name, duration, password, window, violation rules, then **Publish exam**.
4. Share `https://your-site/index.html?exam=CODE` (the link is copied automatically).
5. Use **Results CSV** in the exam list to download scores. Everything is also in the auto-created Google Sheet "AnbuExam Data".

### Question file formats
- XML: `<exam><question answer="C"><text>…</text><option>…</option>…</question></exam>`
- CSV: `question,A,B,C,D,answer` (answer = letter or option text; 2 to any number of options)
- JSON: `[{"q":"…","options":["…"],"answer":"C"}]`

## What the server adds
- Password and answer key stay on the server, not in page source.
- One attempt per email across all devices; the timer resumes from the original start time.
- Server scores answers, saves violations, optionally emails the score.
- Leave the exam code blank on the student page to use the original Google Form mode (old behaviour is unchanged).

## Unchanged features
Fullscreen, tab/focus detection, violation policy, grace-period return, reload counting, copy/right-click/devtools-shortcut blocking, five-minute and one-minute warnings, auto close on timeout.

## Honest limits
A web page cannot stop Alt+Tab, screenshots, a second device or developer tools; it only detects and records. Send-answers needs internet: if it fails the student can press Retry. A very large cohort submitting at the same second may queue for a few seconds (Apps Script lock).
