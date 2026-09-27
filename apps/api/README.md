# CrowdLog API

This folder holds the NestJS backend, Prisma schema, event/template API, and
the first attendance-record extraction and review endpoints.

## Database Model

The key design is dynamic templates:

```text
Event
-> AttendanceTemplate
-> TemplateField
-> AttendanceDocument
-> AttendanceRecord
-> AttendanceRecordValue
```

This means each event can define its own attendance fields without creating a
new database table for every event.

## Commands

Run from the repo root:

```bash
npm run build:api
npm run test:ocr
npm run start:api
npm run db:validate
npm run db:format
npm run db:generate
npm run db:migrate
npm run db:studio
```

Before connecting to a real PostgreSQL database, copy `.env.example` to `.env`
inside `apps/api` and adjust `DATABASE_URL`.

For Supabase, use the **Session pooler** connection string from the dashboard's
Connect panel. The direct connection string uses `db.[PROJECT-REF].supabase.co`,
which may require IPv6. The shared Session pooler is reachable over IPv4 and is
the better fit for local development on many networks.

The repo includes a root `docker-compose.yml` for local PostgreSQL. If Docker is
installed, run this from the repo root:

```bash
docker compose up -d postgres
npm run db:migrate
```

## First API Routes

```text
GET  /health
GET  /auth/me
POST /auth/sign-in
POST /auth/sign-out
GET  /events
POST /events
GET  /events/:eventId
DELETE /events/:eventId
POST /events/:eventId/templates
POST /templates/:templateId/fields
GET  /events/:eventId/documents
POST /events/:eventId/documents
GET  /uploads/:fileName
GET  /events/:eventId/records
POST /events/:eventId/records
POST /events/:eventId/mock-extract
POST /documents/:documentId/extract
POST /documents/:documentId/mock-extract
PATCH /records/:recordId
POST /records/:recordId/approve
POST /records/:recordId/reject
```

`POST /events` can create an event, its default attendance template, and the
template fields in one request.

## Authentication

The API now supports a local learning-project auth flow:

- `POST /auth/sign-in` accepts an email and optional name, upserts a user, and
  sets an HTTP-only session cookie.
- `GET /auth/me` returns the signed-in user or `null`.
- `POST /auth/sign-out` clears the session cookie and deletes the server-side
  session.
- Event, document, extraction, and record routes require a valid session.
- New events are owned by the signed-in user and create an owner membership.
- Existing ownerless local events are claimed by the first user who signs in, so
  development data remains usable after enabling auth.

Reviewer role management is still a later phase slice.

## OCR Providers

The API selects an OCR provider with `OCR_PROVIDER`:

- `auto` uses local Windows OCR for uploaded image files on Windows, then falls
  back to mock rows when local OCR is unavailable.
- `mock` always generates mock review rows.
- `windows` requires local Windows OCR and fails if it cannot run.

`POST /documents/:documentId/extract` runs extraction for an uploaded document.
OCR maps text into the fields already saved on the event template using field
keys, labels, saved aliases, and common attendance header variants. Extracted
values are cleaned and validated by field type before they are saved for review.
The Windows OCR provider also repairs common low-resolution glyph mistakes in
headers and values, and uses adaptive row grouping plus center-based column
matching for noisy spreadsheet screenshots. Suspicious values lower cell
confidence and persist validation issue text on
`attendance_record_values.validation_issues`, which the review UI can show under
the affected cell.

Columns that do not exist as template fields may be returned as `suggestedFields`
so the frontend can add them to the template before re-extracting the document.

Example body:

```json
{
  "title": "Computer Science Seminar",
  "description": "Department seminar attendance",
  "eventDate": "2026-09-17",
  "templateName": "Default attendance template",
  "fields": [
    {
      "label": "Name",
      "key": "name",
      "type": "text",
      "required": true,
      "sortOrder": 1,
      "aliases": ["Full Name"],
      "options": []
    }
  ]
}
```
