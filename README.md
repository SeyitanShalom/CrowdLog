# CrowdLog

Attendance sheets into clean records.

CrowdLog is a full-stack TypeScript learning project for turning attendance
sheets into reviewed, structured records. The project is being built slowly,
with clear architecture decisions, so it can double as a programming learning
project.

## Product Idea

Different attendance sheets collect different data. A school attendance sheet
may need matric number and department, while an event attendance sheet may need
email and phone number. CrowdLog should not create a new database table for
every event. Instead, the data model is:

```text
Event
-> Attendance Template
-> Template Fields
-> Attendance Records
-> Attendance Record Values
```

This lets each event define its own fields without changing the database schema.

## Current State

The current app lets a user:

- create an event draft
- define custom attendance fields
- choose field types like text, email, phone, number, signature, date, and select
- mark fields as required
- add aliases for OCR mapping
- preview the template payload
- save event templates through the NestJS API and Prisma
- sign in and sign out with a local email-based session
- load saved events from the database
- delete saved events
- scope events, uploads, extraction, and review records to the signed-in user
- create owner memberships for new events
- expose owner/reviewer event memberships in API responses and the review UI
- let event owners add reviewers by email and remove reviewer memberships
- show role-aware saved events and owner-only event/team/template actions
- run a mock table extraction for a saved event
- upload PDF or image attendance sheets into local file storage
- list uploaded documents for an event
- run local Windows OCR extraction against a selected uploaded image document
- suggest missing template fields from OCR-detected sheet columns
- route extraction through an OCR provider boundary with mock OCR as the fallback provider
- map OCR columns with template labels, field keys, saved aliases, and common header variants
- clean and validate extracted values by field type before review
- lower cell and row confidence when OCR values look invalid or incomplete
- show OCR validation issue text in the review table
- run focused OCR normalization tests
- clean common low-resolution OCR glyph mistakes in headers and values
- use adaptive Windows OCR row grouping and center-based column matching
- review extracted records in an editable table
- save, approve, or reject extracted rows as an event member

There is no cloud OCR, external auth provider, external invitation email flow,
export, search/filter system, or full role-management screen yet.

The project is now organized as an npm workspace monorepo:

```text
crowdlog/
  apps/
    web/             # Next.js frontend
    api/             # Backend API and Prisma schema
  packages/
    shared/          # shared TypeScript types and helper functions
```

The shared package currently holds the event/template/field types and field-key
helpers. This matters because the future NestJS API should speak the same data
language as the frontend.

## Stack

- Frontend: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Styling: Tailwind CSS
- Storage: local file storage first, cloud storage later
- OCR: local Windows OCR for image uploads, mock OCR fallback, cloud OCR later

## Current Architecture

The backend is split into small NestJS modules:

```text
apps/api/src/events/       # event, template, and template-field API
apps/api/src/documents/    # local file upload and document listing
apps/api/src/ocr/          # OCR provider interface, provider selection, mock and Windows OCR
apps/api/src/records/      # extraction persistence, review rows, approve/reject
apps/api/src/prisma/       # Prisma client service/module
```

The frontend currently has one main working screen:

```text
apps/web/src/app/_components/template-builder.tsx
```

It contains the event/template builder and the review workspace. This file is
now large and should eventually be split into smaller components, but it is
kept together for now while the workflow is still changing quickly.

Shared types live in:

```text
packages/shared/src/crowdlog-types.ts
packages/shared/src/template-utils.ts
```

## Learning Phases

1. Set up the TypeScript monorepo foundation. Done.
2. Design the Prisma database schema. Done.
3. Build the event/template/template-field API. Done.
4. Build the frontend dashboard for creating events and fields. Done.
5. Add mock OCR data for extracted attendance rows. Done.
6. Build the review screen for correcting extracted records. Done.
7. Add file upload. Done.
8. Introduce an OCR provider boundary with mock OCR as the first provider. Done.
9. Integrate a first real OCR provider. Done.
10. Add OCR field suggestions. Done.
11. Add OCR validation, alias mapping, and provider polish. Done for local OCR.
12. Add authentication and roles. In progress:
    local sessions, event ownership, protected routes, reviewer add/remove, and
    role-aware review UI are done. Auth/session route tests remain.
13. Add export, search, filters, and portfolio polish.

## API Routes Implemented

```text
GET   /health
GET   /auth/me
POST  /auth/sign-in
POST  /auth/sign-out

GET   /events
POST  /events
GET   /events/:eventId
DELETE /events/:eventId
POST  /events/:eventId/members
DELETE /events/:eventId/members/:memberId
POST  /events/:eventId/templates
POST  /templates/:templateId/fields

GET   /events/:eventId/documents
POST  /events/:eventId/documents
GET   /uploads/:fileName

GET   /events/:eventId/records
POST  /events/:eventId/records
POST  /events/:eventId/mock-extract
POST  /documents/:documentId/extract
POST  /documents/:documentId/mock-extract
PATCH /records/:recordId
POST  /records/:recordId/approve
POST  /records/:recordId/reject
```

## First Database Tables

- `users`
- `events`
- `attendance_templates`
- `template_fields`
- `attendance_documents`
- `attendance_records`
- `attendance_record_values`
- `user_sessions`
- `event_memberships`

## Development Note

This project lives in:

```text
C:\Users\user\Documents\Attendance Record Website\crowdlog
```

## Getting Started

Run commands from the repo root.

Start PostgreSQL, if using the included local database:

```bash
docker compose up -d postgres
```

Run migrations after setting `DATABASE_URL` in `apps/api/.env`:

```bash
npm run db:migrate
```

Start the API in one terminal:

```bash
npm run build:api
npm run start:api
```

Start the frontend in another terminal:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful scripts:

```bash
npm run dev
npm run lint
npm run build
npm run build:api
npm run test:ocr
npm run db:validate
npm run db:format
npm run db:generate
npm run db:migrate
npm run db:studio
```

The main frontend files are:

```text
apps/web/src/app/page.tsx
apps/web/src/app/_components/template-builder.tsx
```

The frontend now reads and saves events through the API. For local development,
copy `apps/web/.env.example` to `apps/web/.env.local` if you need to customize
the API URL:

```env
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

The shared domain files are:

```text
packages/shared/src/crowdlog-types.ts
packages/shared/src/template-utils.ts
```

The Prisma schema is:

```text
apps/api/prisma/schema.prisma
```

The first migration is:

```text
apps/api/prisma/migrations/20260916000000_init_dynamic_templates/migration.sql
```

If Docker is installed, start the local PostgreSQL database with:

```bash
docker compose up -d postgres
npm run db:migrate
```

## OCR Providers

The OCR provider boundary is now in place. Extraction runs through
`OcrProvider`, while `RecordsService` still owns persistence, document status
updates, and review-record creation.

Provider selection is controlled by API environment variables:

```env
OCR_PROVIDER="auto"
OCR_FALLBACK_TO_MOCK="true"
```

- `auto` uses local Windows OCR for uploaded image files on Windows, then falls
  back to mock rows when local OCR is unavailable.
- `mock` always generates mock rows.
- `windows` requires local Windows OCR for uploaded image files.

The Windows OCR provider maps recognized table text into fields that already
exist on the event template. It now considers field keys, labels, saved aliases,
and common attendance header variants, so headers like `Matric No` can map to a
saved `matric_number` field.

Windows OCR also cleans extracted cell text, validates values by field type, and
lowers confidence for suspicious cells. It repairs common low-resolution glyph
mistakes like `Matr1c N0`, `c0m`, `O8O`, and `R0dent`, and uses adaptive row
grouping plus center-based column matching for noisier spreadsheet screenshots.
The review workspace already highlights low-confidence values and now shows
validation issue text, so invalid email, phone, number, date, select, signature,
or required-field values can be routed toward human correction.

When OCR detects a likely missing sheet column, the review workspace can suggest
a new template field and re-extract the selected document after adding it.

## Next Phase

Finish phase 12: authentication and roles.

1. Add auth/session tests around protected routes.
2. Add role tests for owner-only event/team/template changes.
3. Add reviewer workflow tests for document access and row review actions.
4. Consider ownership transfer or role-change flows after the basic tests exist.
5. Start phase 13 with export, search, filters, and portfolio polish.

## Still Left To Build

- Cloud OCR provider integration.
- Form-style attendance sheets.
- Multi-page PDF handling.
- Editing existing events/templates instead of only creating new ones.
- Document delete/replace and uploaded file cleanup.
- External reviewer invitation emails and full role-management UI.
- Auth/session tests around protected routes.
- CSV/Excel export.
- Search, filters, and reporting.
- Automated tests.
- Breaking the large frontend component into smaller components.

## New Chat Handoff

If continuing this project in a new chat, paste this:

```text
I am building a full-stack TypeScript project called CrowdLog.

Tagline: Attendance sheets into clean records.

The project lives at:
C:\Users\user\Documents\Attendance Record Website\crowdlog

Stack:
- Next.js + TypeScript frontend in apps/web
- NestJS + TypeScript backend in apps/api
- PostgreSQL + Prisma
- Shared TypeScript types in packages/shared

Important architecture:
CrowdLog uses a dynamic template system:
Event -> Attendance Template -> Template Fields -> Attendance Records -> Attendance Record Values.
Do not create a new database table per event.

Already done:
- TypeScript monorepo
- Prisma schema and first migration
- Event/template/template-field API
- Frontend event/template builder
- Saved event deletion
- Mock OCR extraction
- Editable review table
- Approve/reject record workflow
- Local PDF/image file upload
- Uploaded document preview
- Mock extraction can run against an uploaded document
- OCR provider boundary with mock OCR as the first provider
- Local Windows OCR can extract uploaded image documents through the provider boundary
- OCR can suggest missing uploaded sheet columns, such as `taxa`
- Windows OCR can map columns using labels, keys, aliases, and common header variants
- Windows OCR can clean and validate extracted values by field type and lower confidence for suspicious cells
- Review cells show OCR validation issue text
- Focused OCR normalization tests can run with `npm run test:ocr`
- Windows OCR has low-resolution glyph cleanup and adaptive row/column grouping
- Local email sign-in/sign-out uses HTTP-only sessions
- Events, documents, extraction, and records are protected by owner/member access
- New events create an owner membership for the signed-in user
- Event responses include owner/reviewer memberships
- Owners can add and remove reviewers from the review workspace
- Owners manage reviewers, event deletion, templates, and suggested OCR fields
- Reviewers can access the event workspace and review extracted rows

Current next phase:
Finish phase 12 with auth/session and role tests, then begin phase 13 export,
search, filters, and portfolio polish.

Please inspect the repo first, avoid reading .env secrets, then continue from the authentication and roles phase.
```
