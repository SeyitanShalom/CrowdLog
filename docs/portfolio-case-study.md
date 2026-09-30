# CrowdLog Portfolio Case Study

CrowdLog turns scanned attendance sheets into reviewed, structured records. It
is built as a full-stack TypeScript learning project, with the architecture
kept explicit enough to show the tradeoffs behind each phase.

## Problem

Attendance sheets rarely share one fixed format. A school seminar may collect
name, matric number, department, level, and signature. A public event may care
about name, email, phone, organization, and consent. Creating a separate table
for every event would make the system brittle, so CrowdLog uses dynamic
templates instead:

```text
Event -> Attendance Template -> Template Fields -> Attendance Records -> Values
```

That gives each event its own field shape while preserving one durable database
model.

## Current Workflow

1. A signed-in owner creates an event and defines the attendance template.
2. The owner uploads a PDF or image attendance sheet.
3. Extraction runs through an OCR provider boundary. Local Windows OCR handles
   image uploads when available, and mock OCR remains available for development.
4. Extracted rows are normalized, confidence-scored, and validated by field
   type before they reach review.
5. Owners or reviewers correct rows, approve/reject them, and export the final
   event records to CSV or Excel.
6. Reporting panels show event completion, document progress, and reviewer
   progress.

## Architecture Highlights

- **Monorepo:** Next.js frontend, NestJS API, Prisma/PostgreSQL database, and a
  shared TypeScript package for domain types.
- **Dynamic schema:** Event templates and fields model changing sheet formats
  without creating new tables per event.
- **Provider boundary:** OCR extraction runs through a provider interface, so
  local OCR, mock OCR, and future cloud OCR can share the same persistence path.
- **Review-first workflow:** OCR output is treated as a draft that humans can
  correct, approve, reject, search, filter, and export.
- **Role-aware access:** Owners and reviewers can access the same event review
  workspace, while owner-only actions stay protected.
- **Portfolio-ready exports:** Full-event CSV and Excel exports are generated
  server-side, separate from the currently filtered table view.

## Product Decisions

- **Human review over automation theater:** The app does not pretend OCR is
  perfect. It exposes low-confidence and invalid values so users can correct
  them.
- **Local-first infrastructure:** Local file storage and Windows OCR keep the
  project runnable without paid cloud services. Cloud storage and cloud OCR can
  be added later behind existing boundaries.
- **Small backend modules:** Auth, events, documents, OCR, records, and Prisma
  are kept separate so each phase can be tested and explained independently.
- **Operational UI:** The interface is closer to an internal tool than a
  marketing site: dense, direct, and centered on repeated review work.

## Demo Narrative

Use this sequence when presenting the project:

1. **Template setup:** Show an event with custom fields and aliases for messy
   sheet headers.
2. **Document intake:** Upload or select an attendance document and run
   extraction.
3. **Review:** Point out confidence, validation issues, editable cells, and row
   status actions.
4. **Collaboration:** Show owner/reviewer membership and explain protected
   owner-only actions.
5. **Reporting:** Show completion, document progress, and reviewer progress.
6. **Export:** Download the reviewed records as CSV or Excel.

## Suggested Screenshot Set

Use the shot list in [screenshots/README.md](./screenshots/README.md). The
recommended portfolio sequence is:

1. `01-template-builder.png`
2. `02-document-extraction.png`
3. `03-review-workspace.png`
4. `04-reporting-panels.png`
5. `05-export-actions.png`

Use `npm run seed:portfolio` to create the anonymized demo event before taking
these screenshots.

## What This Project Demonstrates

- Full-stack TypeScript app structure.
- Dynamic data modeling with Prisma and PostgreSQL.
- Authentication, authorization, and role-aware UI.
- OCR integration behind an interface.
- Human-in-the-loop review workflows.
- Export and reporting features for operational users.
- Incremental delivery with focused tests.

## Next Portfolio Improvements

- Capture the screenshot set from the seeded local demo event.
- Add a short architecture diagram to the README or this case study.
- Split the large review component once the workflow is stable.
- Add a short demo video after the screenshot set is captured.
