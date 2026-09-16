# CrowdLog API

This folder will hold the NestJS backend. For this phase, it starts with the
Prisma database schema so we can design the data model before building API
controllers.

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
GET  /events
POST /events
GET  /events/:eventId
POST /events/:eventId/templates
POST /templates/:templateId/fields
```

`POST /events` can create an event, its default attendance template, and the
template fields in one request.

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
