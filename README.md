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
- add aliases for future OCR mapping
- preview the template payload
- save event templates through the NestJS API and Prisma
- load saved events from the database
- run a mock table extraction for a saved event
- upload PDF or image attendance sheets into local file storage
- list uploaded documents for an event
- run mock extraction against a selected uploaded document
- route extraction through an OCR provider boundary with mock OCR as the first provider
- review extracted records in an editable table
- save, approve, or reject extracted rows

There is no real OCR, authentication, export, search/filter system, or role
system yet.

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
- OCR: mock OCR first, real provider later

## Current Architecture

The backend is split into small NestJS modules:

```text
apps/api/src/events/       # event, template, and template-field API
apps/api/src/documents/    # local file upload and document listing
apps/api/src/ocr/          # OCR provider interface and mock provider
apps/api/src/records/      # mock extraction, review rows, approve/reject
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
9. Integrate a real OCR provider.
10. Add authentication and roles.
11. Add export, search, filters, and portfolio polish.

## API Routes Implemented

```text
GET   /health

GET   /events
POST  /events
GET   /events/:eventId
POST  /events/:eventId/templates
POST  /templates/:templateId/fields

GET   /events/:eventId/documents
POST  /events/:eventId/documents
GET   /uploads/:fileName

GET   /events/:eventId/records
POST  /events/:eventId/records
POST  /events/:eventId/mock-extract
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

## Next Phase

The OCR provider boundary is now in place. Mock extraction runs through
`OcrProvider` and `MockOcrProvider`, while `RecordsService` still owns
persistence, document status updates, and review-record creation.

The next phase is to plug a real OCR provider behind that same boundary without
rewriting the review workflow. Suggested implementation direction:

1. Choose the first provider to try, such as AWS Textract, Google Document AI,
   or Azure Document Intelligence.
2. Add provider configuration through API environment variables.
3. Implement a second provider class that returns the same extracted row shape
   as `MockOcrProvider`.
4. Add field mapping from OCR headers and aliases into template field keys.
5. Preserve mock OCR as the local development fallback.

## Still Left To Build

- Real OCR provider integration.
- Alias-based field mapping, such as `Matric No` -> `matric_number`.
- Validation of extracted values by field type.
- Form-style attendance sheets.
- Multi-page PDF handling.
- Editing existing events/templates instead of only creating new ones.
- Document delete/replace and uploaded file cleanup.
- Authentication, users, event ownership, and roles.
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
- Mock OCR extraction
- Editable review table
- Approve/reject record workflow
- Local PDF/image file upload
- Uploaded document preview
- Mock extraction can run against an uploaded document
- OCR provider boundary with mock OCR as the first provider

Current next phase:
Plug a real OCR provider into the existing OCR provider boundary.
The goal is to make uploaded attendance sheets produce real extracted review rows while preserving the existing review workflow.

Please inspect the repo first, avoid reading .env secrets, then continue from the OCR provider boundary phase.
```
