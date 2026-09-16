# CrowdLog

Attendance sheets into clean records.

CrowdLog is a full-stack TypeScript learning project for turning attendance
sheets into reviewed, structured records. The first milestone focuses only on
the dynamic event/template/field system. OCR, uploads, authentication, and
exports come later.

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
- save event templates in browser local storage

There is no OCR, upload, backend API, Prisma schema, or PostgreSQL database yet.

The project is now organized as an npm workspace monorepo:

```text
crowdlog/
  apps/
    web/             # Next.js frontend
  packages/
    shared/          # shared TypeScript types and helper functions
```

The shared package currently holds the event/template/field types and field-key
helpers. This matters because the future NestJS API should speak the same data
language as the frontend.

## Planned Stack

- Frontend: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Styling: Tailwind CSS
- Storage: local file storage first, cloud storage later
- OCR: mock OCR first, real provider later

## Learning Phases

1. Set up the TypeScript monorepo foundation. Done.
2. Design the Prisma database schema.
3. Build the event/template/template-field API.
4. Build the frontend dashboard for creating events and fields.
5. Add mock OCR data for extracted attendance rows.
6. Build the review screen for correcting extracted records.
7. Add file upload.
8. Integrate a real OCR provider.
9. Add authentication and roles.
10. Add export, search, filters, and portfolio polish.

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

Run commands from the repo root:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Useful scripts:

```bash
npm run dev
npm run lint
npm run build
```

The main frontend files are:

```text
apps/web/src/app/page.tsx
apps/web/src/app/_components/template-builder.tsx
```

The shared domain files are:

```text
packages/shared/src/crowdlog-types.ts
packages/shared/src/template-utils.ts
```

## Next Phase

The next backend phase is to design the Prisma schema for `events`,
`attendance_templates`, `template_fields`, and the later record/document tables.
