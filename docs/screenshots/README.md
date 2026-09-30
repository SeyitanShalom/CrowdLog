# Screenshot Guide

This folder is for portfolio screenshots that show the end-to-end CrowdLog
workflow. Capture screenshots from a local event with realistic sample rows so
the images communicate the actual product flow.

## Capture Setup

1. Start PostgreSQL and apply migrations:

   ```bash
   docker compose up -d postgres
   npm run db:migrate
   ```

2. Start the API:

   ```bash
   npm run build:api
   npm run start:api
   ```

3. Start the frontend:

   ```bash
   npm run dev
   ```

4. Seed the portfolio demo event:

   ```bash
   npm run seed:portfolio
   ```

   If this cannot reach the database, confirm that `apps/api/.env` points to
   the same database used by the running API and that the database is reachable.

5. Capture the screenshot set:

   ```bash
   npm run screenshots:portfolio
   ```

The seed command is idempotent for this demo event: it recreates the portfolio
event owned by `owner.demo@crowdlog.local` while leaving other events alone.
The capture command opens Chrome or Edge in headless mode, signs in as the demo
owner, loads the seeded event, scrolls to each screenshot section, and saves the
files in this folder.

The capture command checks `http://localhost:4000/health` and
`http://localhost:3000` before opening Chrome. If either check fails, start the
API and frontend in separate terminals and run the capture command again.

## Shot List

### `01-template-builder.png`

Show the event and attendance template builder with fields such as Name,
Matric Number, Department, Level, and Signature.

Caption: "Dynamic attendance templates let each event define its own fields
without changing the database schema."

### `02-document-extraction.png`

Show a selected uploaded document and the extraction action.

Caption: "Uploaded sheets move through an OCR provider boundary, with local
Windows OCR and mock extraction available during development."

### `03-review-workspace.png`

Show extracted rows in the review table with statuses, confidence text, and
editable values.

Caption: "OCR output enters a human review workflow where members can correct,
approve, or reject each row."

### `04-reporting-panels.png`

Show the event completion, document progress, and reviewer progress panels.

Caption: "Reporting panels summarize review progress by event, document, and
reviewer."

### `05-export-actions.png`

Show search/filter controls plus visible-row CSV, full-event CSV, and Excel
export actions.

Caption: "Reviewers can export the current view or full-event records after
cleanup."

## Capture Notes

- Prefer desktop screenshots around `1440x1000` for the portfolio case study.
- Also capture one mobile-width screenshot of the review workspace if the final
  portfolio page needs responsive proof.
- Avoid showing real student names, emails, phone numbers, or matric numbers.
- Use mock data or anonymized records for all public screenshots.
- If Chrome is installed somewhere unusual, pass the path with:
  `npm run screenshots:portfolio -- --chrome-path "C:\Path\To\chrome.exe"`.
