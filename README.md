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
- choose field types like text, email, phone, number, signature, date, select,
  and multi-select
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
- let event owners promote reviewers to owners and demote owners back to reviewers
- prevent role changes that would leave an event with no owner
- show role-aware saved events and owner-only event/team/template actions
- show a fuller team-management panel with owner/reviewer counts, grouped
  roster sections, joined dates, role menus, and reviewer removal controls
- open a standalone event team-management route at `/events/:eventId/team`
- manage the same owner/reviewer roster from the standalone team route
- queue reviewer invitation emails when owners add new reviewers
- send invitation payloads to a generic HTTP delivery endpoint when configured
- send reviewer invitation emails through Resend when configured
- send reviewer invitation emails through Postmark when configured
- send reviewer invitation emails through SendGrid when configured
- keep reviewer creation successful if invitation delivery fails
- open invited events from `?eventId=...` links after the reviewer signs in
- run a mock table extraction for a saved event
- upload PDF or image attendance sheets into local file storage
- list uploaded documents for an event
- run local Windows OCR extraction against a selected uploaded image document
- choose a page range when extracting PDF attendance sheets
- run page-aware mock fallback extraction for uploaded PDF documents
- render selected PDF pages into images for provider extraction when `pdftoppm`
  is available
- choose full-document PDF OCR for cloud-capable providers with
  `OCR_PDF_RENDER_MODE="full-document"`
- automatically use provider-native full-document PDF OCR in `auto` mode when
  Azure is configured or the HTTP bridge opts in
- record PDF rendering skip or fallback reasons in raw OCR metadata
- choose table-row or form-entry extraction layout for selected documents
- run form-style mock fallback extraction into reviewed records
- parse label/value form layouts through Windows OCR for image inputs and
  rendered PDF pages
- capture wrapped multiline values in Windows form-layout OCR
- treat checkbox-style signature marks as form values when they sit beside a
  signature label
- treat simple handwritten-looking stroke marks in signature regions as
  signature values
- capture split stroke clusters in signature regions without treating blank
  signature lines as signed
- map checked form option groups into select-field values
- preserve multiple checked select options as reviewable comma-separated values
  with validation issue text
- define true multi-select template fields and review their values with
  checkbox controls
- normalize multiple checked form options as valid multi-select values
- send OCR extraction requests to a generic HTTP OCR endpoint when configured
- send OCR extraction requests to Azure Document Intelligence when configured
- map Azure layout tables into reviewed records with bounding boxes and
  suggested fields for unmapped columns
- replace uploaded attendance sheets and clear their old extracted rows
- delete uploaded attendance sheets with their extracted rows and local files
- suggest missing template fields from OCR-detected sheet columns
- route extraction through an OCR provider boundary with mock OCR as the fallback provider
- map OCR columns with template labels, field keys, saved aliases, and common header variants
- clean and validate extracted values by field type before review
- lower cell and row confidence when OCR values look invalid or incomplete
- show OCR validation issue text in the review table
- run focused OCR normalization and provider adapter tests
- run focused API auth/session and role-access tests
- clean common low-resolution OCR glyph mistakes in headers and values
- use adaptive Windows OCR row grouping and center-based column matching
- use Windows OCR label/value matching for first-pass form-layout extraction
- review extracted records in an editable table
- save, approve, or reject extracted rows as an event member
- record which reviewer approved or rejected each row
- search review rows by row, status, document, or field values
- filter review rows by status
- see review summary counts for visible, reviewed, approved, rejected, needs-review, and draft rows
- see reporting panels for event completion, document progress, and reviewer progress
- export the currently visible review rows to CSV
- export all event review rows from the server to CSV
- export all event review rows from the server to Excel
- document the portfolio case study and screenshot shot list
- seed an anonymized portfolio demo event for screenshot capture
- capture portfolio screenshots with a Chrome/Edge headless script
- store the captured five-image portfolio screenshot gallery in `docs/screenshots`

There is no Google Document AI/Vision adapter, AWS Textract adapter, external
auth provider, SMTP email adapter, external export API, or advanced analytics
yet.

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
- OCR: local Windows OCR for image uploads, Azure Document Intelligence, generic
  HTTP OCR endpoint, mock OCR fallback, additional vendor-specific cloud OCR
  later

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
12. Add authentication and roles. Done for local sessions, event ownership,
    protected routes, reviewer add/remove, role-aware review UI, and focused
    auth/role tests.
13. Add export, search, filters, and portfolio polish. Done for the current
    portfolio pass:
    visible-row CSV export, server-side full-event CSV/Excel export, search,
    status filters, review summary counts, reviewer attribution, and basic
    reporting panels are done in the review workspace. The portfolio case study
    and screenshot capture guide are documented, the anonymized demo can be
    seeded, and the five-image screenshot gallery has been captured in
    `docs/screenshots`.
14. Add role-management follow-up controls. Done for compact owner controls:
    owners can promote reviewers to owners, demote owners to reviewers when at
    least one owner remains, and the legacy `ownerId` is kept pointed at an
    owner for compatibility. Focused API tests cover promotion, demotion,
    last-owner protection, and reviewer denial.
15. Add document lifecycle cleanup. Done for local storage:
    event members can replace an uploaded attendance sheet, which clears that
    document's old extracted rows and resets it to uploaded; event members can
    delete an uploaded sheet, which deletes its extracted rows and removes the
    local file when it lives under `/uploads`. Focused API tests cover delete,
    replace, row cleanup, and outsider denial.
16. Add first multi-page PDF extraction controls. Done for provider-boundary
    support:
    document extraction accepts a PDF page range, estimates the uploaded PDF's
    page count for clamping, and carries page metadata through the mock fallback
    provider. The review workspace shows page range controls when a PDF is
    selected. Focused tests cover page-aware mock rows and PDF page-range
    clamping before provider extraction.
17. Add first form-style extraction controls. Done for provider-boundary
    support:
    document extraction accepts a `table` or `form` layout, the review
    workspace exposes the layout selector for selected documents, and the mock
    OCR fallback can emit form-entry records with field-level confidence and
    bounding boxes. Focused tests cover form-style mock output and layout
    propagation from records extraction into the OCR provider.
18. Add fuller team-management controls. Done for the in-workspace role
    management pass:
    the review workspace now has a richer team-management panel with total,
    owner, and reviewer counts; grouped owner/reviewer roster sections; joined
    dates; role menus for owner/reviewer changes; and reviewer removal controls.
    The existing API last-owner protection remains visible in the UI by
    disabling the final owner's demotion menu.
19. Add first reviewer invitation email flow. Done for the local provider pass:
    adding a new reviewer now queues an invitation email through an
    `InvitationEmailService`, with `console`, `file`, and `off` provider modes.
    Invitation links include `?eventId=...`, and the frontend opens that event
    after the invited reviewer signs in with an account that has access.
    Focused API tests cover invitation queuing, duplicate-member no-resend
    behavior, and invite-link email copy.
20. Add first external invitation delivery provider. Done for the generic HTTP
    provider pass:
    `InvitationEmailService` now supports `INVITATION_EMAIL_PROVIDER="http"`,
    posts a provider-neutral reviewer invitation payload to
    `INVITATION_EMAIL_HTTP_ENDPOINT`, and can attach an optional bearer token.
    Reviewer membership creation remains successful if invitation delivery
    fails, with the failure logged for follow-up. Focused API tests cover HTTP
    payload shape, required endpoint validation, and non-blocking delivery
    failure behavior.
21. Add first provider-specific transactional email adapter. Done for Resend:
    `InvitationEmailService` now supports `INVITATION_EMAIL_PROVIDER="resend"`,
    posts reviewer invitation emails to the Resend email API, supports a
    configurable sender and optional reply-to address, and sends an idempotency
    key for duplicate protection. Focused API tests cover the Resend request
    body, auth header, idempotency key, provider response id, and required
    configuration validation.
22. Add another provider-specific transactional email adapter. Done for
    Postmark: `InvitationEmailService` now supports
    `INVITATION_EMAIL_PROVIDER="postmark"`, posts reviewer invitation emails to
    the Postmark email API, supports the shared sender/reply-to settings plus an
    optional Postmark message stream, and returns the Postmark message id when
    available. Focused API tests cover the Postmark request body, server-token
    header, message stream, provider response id, and required configuration
    validation.
23. Add SendGrid transactional email delivery. Done:
    `InvitationEmailService` now supports
    `INVITATION_EMAIL_PROVIDER="sendgrid"`, posts reviewer invitation emails to
    the SendGrid Mail Send API, parses `Name <email@example.com>` sender strings
    into SendGrid's structured address shape, supports optional reply-to, and
    returns the SendGrid message id header when available. Focused API tests
    cover the SendGrid request body, auth header, custom args, structured
    sender/reply-to parsing, response id, and required configuration validation.
24. Add a standalone team-management route. Done:
    event members can open `/events/:eventId/team` from the saved-events list or
    the compact in-workspace team panel. The route loads the signed-in member,
    fetches the event by id, shows owner/reviewer counts and grouped roster
    sections, and lets owners add reviewers, remove reviewers, promote reviewers
    to owners, and demote owners when another owner remains.
25. Add first real form-layout OCR parsing. Done for local Windows OCR:
    when extraction requests `layout: "form"`, `WindowsOcrProvider` now scans
    OCR words for template field labels using keys, labels, aliases, and common
    field terms; extracts same-line or nearby values; groups repeated form
    entries; normalizes and validates values by field type; carries bounding
    boxes; and emits form-shaped raw OCR metadata. Focused OCR tests cover
    same-line label/value pairs, low-resolution value cleanup, signature values,
    and repeated form entries.
26. Add a generic cloud OCR bridge. Done for provider-neutral HTTP:
    `OCR_PROVIDER="http"` now sends document metadata, base64 file content,
    template fields, and extraction options to `OCR_HTTP_ENDPOINT`. The HTTP
    provider maps remote rows back onto the local template fields, normalizes
    field values when needed, preserves bounding boxes, accepts suggested fields,
    and supports an optional bearer token. In `auto` mode, CrowdLog can try the
    HTTP OCR endpoint before falling back to mock rows when Windows OCR is not
    available. Focused OCR tests cover request payloads, bearer auth, response
    mapping, value normalization, suggested fields, and explicit provider
    selection.
27. Add a first vendor-specific cloud OCR adapter. Done for Azure Document
    Intelligence:
    `OCR_PROVIDER="azure"` now posts local uploaded document bytes to Azure
    Document Intelligence, polls the provider's async result URL, maps layout
    table cells back onto saved template fields, normalizes values by field
    type, preserves bounding boxes, and returns suggested fields for unmapped
    table columns. In `auto` mode, CrowdLog can try Azure after local Windows
    OCR and before the generic HTTP bridge when Azure credentials are configured.
    Focused OCR tests cover the Azure request, polling flow, table mapping,
    suggested fields, and explicit provider selection.
28. Broaden first-pass form-layout OCR. Done for wrapped values and checkbox
    signature marks:
    the Windows form parser now keeps wrapped same-field value lines in reading
    order, so address or note-style fields can span multiple OCR rows. Signature
    fields can also use a nearby left-side checkbox mark such as `X` when the
    form uses checkbox-style signing instead of text after the label. Focused
    Windows OCR tests cover multiline value capture, reading order, signature
    checkbox extraction, and bounding boxes spanning wrapped values.
29. Add first richer checkbox-group form parsing. Done for select fields:
    when a form has a saved `select` field with configured options, Windows OCR
    can now detect a checked option group such as `X Present`, map only the
    selected option text into the review value, and still run the value through
    the existing select normalization. Focused Windows OCR tests cover stacked
    checkbox options and confirm the raw extracted value is the selected option,
    not the full option list.
30. Add first handwritten signature-region handling. Done for simple marks:
    the Windows form parser now keeps non-text signature mark candidates around
    for signature fields without letting them affect label detection or normal
    text fields. Simple stroke-like marks in a signature region, such as a
    slash/backslash mark, normalize to a signed value while preserving the mark's
    bounding box. Focused Windows OCR tests cover the signature-region mark,
    normalized boolean value, empty validation issues, and mark bounding box.
31. Harden first production PDF OCR behavior. Done for render-mode and fallback
    visibility:
    PDF rendering now checks `pdftoppm` availability before attempting page
    rendering, supports `OCR_PDF_RENDER_MODE="full-document"` for cloud-capable
    providers that can read PDFs directly, applies `OCR_PDF_RENDER_TIMEOUT_MS`
    to renderer checks and page rendering, and wraps direct-PDF fallback raw OCR
    metadata with the render mode, renderer name, reason, page range, layout,
    and provider result. Focused API tests cover full-document mode, renderer
    unavailability, and preserved provider metadata.
32. Add richer multi-select checkbox-group parsing. Done for reviewable
    preservation:
    when a saved `select` field has multiple checked options in a form checkbox
    group, Windows OCR now preserves the checked option labels in reading order
    as a comma-separated review value instead of silently choosing the first
    match. Select normalization keeps the joined value, lowers confidence, and
    adds validation issue text because the current template model is still a
    single-select field. Focused OCR tests cover normalization and Windows form
    extraction for multiple checked options.
33. Add true multi-select template fields. Done for the first product pass:
    templates can now use a `multi_select` field type across the shared types,
    API validation, Prisma enum mapping, and frontend builder. Multi-select
    fields keep configured options, render as checkbox controls in the review
    table, and let Windows form OCR normalize multiple checked options as a
    valid comma-separated review value without the single-select warning.
    Focused OCR tests cover multi-select normalization and Windows checkbox
    group extraction.
34. Broaden signature-region OCR. Done for split stroke clusters:
    the Windows form parser now carries signature-only stroke tokens through
    form extraction, groups adjacent stroke fragments in the signature region,
    and treats clusters with an angled or curved stroke as signed while ignoring
    plain blank signature lines. Focused Windows OCR tests cover split
    slash/baseline/backslash marks and the blank-line guard.
35. Add provider-native PDF OCR auto routing. Done for Azure and opt-in HTTP:
    when `OCR_PDF_RENDER_MODE="auto"`, document extraction now asks the OCR
    boundary whether the configured provider can read PDFs directly before
    checking `pdftoppm`. Azure advertises native PDF support when its endpoint
    and key are configured, and the generic HTTP bridge can opt in with
    `OCR_HTTP_DIRECT_PDF="true"`. Direct-PDF raw OCR metadata records the
    provider used. Focused API tests cover auto-mode direct PDF routing, Azure
    capability detection, and HTTP opt-in behavior.

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
PATCH /events/:eventId/members/:memberId
DELETE /events/:eventId/members/:memberId
POST  /events/:eventId/templates
POST  /templates/:templateId/fields

GET   /events/:eventId/documents
POST  /events/:eventId/documents
PUT   /documents/:documentId
DELETE /documents/:documentId
GET   /uploads/:fileName

GET   /events/:eventId/records
GET   /events/:eventId/records/export
GET   /events/:eventId/records/export.xlsx
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

Attendance records now also track `reviewed_by_user_id` and `reviewed_at` so
reviewer progress can be reported without changing each event's dynamic fields.

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
npm run test:api
npm run test:ocr
npm run db:validate
npm run db:format
npm run db:generate
npm run db:migrate
npm run db:studio
npm run seed:portfolio
npm run screenshots:portfolio
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

## Portfolio Materials

The portfolio narrative lives in:

```text
docs/portfolio-case-study.md
```

The screenshot capture guide and recommended filenames live in:

```text
docs/screenshots/README.md
```

Capture screenshots from a local demo event after the API, frontend, and
database are running, so the portfolio uses realistic reviewed rows without
exposing private attendance data.

Create the anonymized demo event with:

```bash
npm run seed:portfolio
```

Then sign in as `owner.demo@crowdlog.local` and open
`Portfolio Demo: Computer Science Seminar` from the saved events list.

For automated local screenshot capture, run:

```bash
npm run screenshots:portfolio
```

The capture script checks the API and frontend, opens Chrome or Edge headless,
signs in as the demo owner, loads the seeded event, and writes the five PNG
files to `docs/screenshots`.

The current captured gallery contains:

```text
docs/screenshots/01-template-builder.png
docs/screenshots/02-document-extraction.png
docs/screenshots/03-review-workspace.png
docs/screenshots/04-reporting-panels.png
docs/screenshots/05-export-actions.png
```

## Invitation Emails

When an event owner adds a new reviewer, the API queues reviewer invitation copy
through `InvitationEmailService`. The reviewer is still granted access through
the membership record immediately; the email is the notification layer.

Provider selection is controlled by API environment variables:

```env
INVITATION_EMAIL_PROVIDER="console"
CROWDLOG_APP_URL="http://localhost:3000"
INVITATION_EMAIL_OUTBOX_DIR="invitation-outbox"
INVITATION_EMAIL_HTTP_ENDPOINT="https://email-provider.example/send"
INVITATION_EMAIL_HTTP_BEARER_TOKEN=""
RESEND_API_KEY="re_xxxxxxxxx"
POSTMARK_SERVER_TOKEN="postmark-server-token"
SENDGRID_API_KEY="SG.xxxxxxxxx"
INVITATION_EMAIL_FROM="CrowdLog <noreply@example.com>"
INVITATION_EMAIL_REPLY_TO=""
INVITATION_EMAIL_RESEND_ENDPOINT="https://api.resend.com/emails"
INVITATION_EMAIL_POSTMARK_ENDPOINT="https://api.postmarkapp.com/email"
INVITATION_EMAIL_POSTMARK_MESSAGE_STREAM="outbound"
INVITATION_EMAIL_SENDGRID_ENDPOINT="https://api.sendgrid.com/v3/mail/send"
```

- `console` logs the invitation message to the API process. This is the default.
- `file` writes JSON email payloads into `INVITATION_EMAIL_OUTBOX_DIR`.
- `http` posts a provider-neutral JSON payload to
  `INVITATION_EMAIL_HTTP_ENDPOINT`.
- `resend` sends the invitation email through the Resend email API.
- `postmark` sends the invitation email through the Postmark email API.
- `sendgrid` sends the invitation email through the SendGrid Mail Send API.
- `off` disables invitation delivery.

`CROWDLOG_APP_URL` controls the link used in the email. If it is not set, the
API falls back to `APP_BASE_URL`, then `http://localhost:3000`. Invitation links
include the event id as `?eventId=...`; after sign-in, the frontend opens that
event when the signed-in account has access.

When `INVITATION_EMAIL_HTTP_BEARER_TOKEN` is set, the `http` provider sends it
as an `Authorization: Bearer ...` header. Invitation delivery failures are
logged and do not undo reviewer membership creation.

When using `resend`, set `RESEND_API_KEY` and `INVITATION_EMAIL_FROM`.
`INVITATION_EMAIL_REPLY_TO` is optional. `INVITATION_EMAIL_RESEND_ENDPOINT`
defaults to `https://api.resend.com/emails` and is mainly useful for tests or
private gateways.

When using `postmark`, set `POSTMARK_SERVER_TOKEN` and
`INVITATION_EMAIL_FROM`. `INVITATION_EMAIL_REPLY_TO` is optional.
`INVITATION_EMAIL_POSTMARK_ENDPOINT` defaults to
`https://api.postmarkapp.com/email`, and
`INVITATION_EMAIL_POSTMARK_MESSAGE_STREAM` is optional when you want to target a
specific Postmark stream such as `outbound`.

When using `sendgrid`, set `SENDGRID_API_KEY` and `INVITATION_EMAIL_FROM`.
`INVITATION_EMAIL_FROM` and `INVITATION_EMAIL_REPLY_TO` can use either a plain
email address or `Name <email@example.com>`. `INVITATION_EMAIL_SENDGRID_ENDPOINT`
defaults to `https://api.sendgrid.com/v3/mail/send` and is mainly useful for
tests or private gateways.

There is no SMTP adapter yet.

## OCR Providers

The OCR provider boundary is now in place. Extraction runs through
`OcrProvider`, while `RecordsService` still owns persistence, document status
updates, and review-record creation.

Provider selection is controlled by API environment variables:

```env
OCR_PROVIDER="auto"
OCR_FALLBACK_TO_MOCK="true"
OCR_PDF_RENDER_MODE="auto"
OCR_PDF_RENDER_TIMEOUT_MS="60000"
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://your-resource.cognitiveservices.azure.com"
AZURE_DOCUMENT_INTELLIGENCE_KEY=""
AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID="prebuilt-layout"
AZURE_DOCUMENT_INTELLIGENCE_API_VERSION="2024-11-30"
AZURE_DOCUMENT_INTELLIGENCE_FEATURES=""
AZURE_DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS="1000"
AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS="60000"
OCR_HTTP_ENDPOINT="https://ocr-provider.example/extract"
OCR_HTTP_BEARER_TOKEN=""
OCR_HTTP_INCLUDE_FILE="true"
OCR_HTTP_DIRECT_PDF="false"
```

- `auto` uses local Windows OCR for uploaded image files on Windows, then tries
  Azure Document Intelligence when configured, then falls back to the configured
  HTTP OCR endpoint when available, then mock rows.
- `mock` always generates mock rows.
- `windows` requires local Windows OCR for uploaded image files.
- `azure` sends local uploaded documents to Azure Document Intelligence.
- `http` sends a provider-neutral OCR request to `OCR_HTTP_ENDPOINT`.

When `OCR_PROVIDER="azure"`, set `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` and
`AZURE_DOCUMENT_INTELLIGENCE_KEY`. The adapter defaults to the
`prebuilt-layout` model and Azure Document Intelligence API version
`2024-11-30`, sends the document bytes to the async analyze endpoint, carries
PDF page-range choices through the `pages` query parameter, and polls the
provider result URL until extraction succeeds. Set
`AZURE_DOCUMENT_INTELLIGENCE_FEATURES` when a deployment wants optional Azure
features such as `keyValuePairs` for form-style documents.

Azure layout tables are mapped into CrowdLog review rows by matching column
headers against field keys, labels, saved aliases, and common attendance terms.
Values still pass through CrowdLog's existing type normalization and validation
before they are saved. Unmapped Azure table columns can be returned as
`suggestedFields` so the reviewer can add missing template fields and
re-extract.

When `OCR_HTTP_ENDPOINT` is set, the HTTP OCR provider posts document metadata,
base64 file content, template fields, and extraction options to the endpoint.
`OCR_HTTP_BEARER_TOKEN` adds an `Authorization: Bearer ...` header.
`OCR_HTTP_INCLUDE_FILE="false"` sends metadata only, which is useful when an
external provider can read the document by URL or another private gateway. Set
`OCR_HTTP_DIRECT_PDF="true"` only when that endpoint can read uploaded PDFs
directly and should be allowed to bypass page rendering in `auto` mode.

For uploaded PDFs, extraction now accepts a page range. The backend estimates
the PDF page count from the local uploaded file and clamps the requested range
before calling the OCR provider. In `auto` render mode, CrowdLog first lets
provider-native PDF readers handle the full document when available, such as
configured Azure Document Intelligence or an HTTP bridge with
`OCR_HTTP_DIRECT_PDF="true"`. Otherwise, when `pdftoppm` is available, the
backend renders the selected PDF pages to temporary PNG files and sends each
page through the configured OCR provider. Set
`OCR_PDF_RENDER_MODE="full-document"` to force direct PDF OCR, or
`OCR_PDF_RENDER_MODE="render-pages"` to force page rendering. If rendering is
skipped or unavailable, CrowdLog sends the full PDF to the OCR provider and
stores the render mode, renderer, reason, direct provider, page range, layout,
and provider result in raw OCR metadata. `OCR_PDF_RENDER_TIMEOUT_MS` controls
both renderer availability checks and page rendering.

Extraction also accepts a layout hint: `table` for attendance rows or `form`
for form-entry sheets. The mock fallback can generate form-style extracted
records for workflow testing, and the Windows OCR provider now has a first real
form parser for label/value layouts.

The Windows OCR provider maps recognized table text into fields that already
exist on the event template. It now considers field keys, labels, saved aliases,
and common attendance header variants, so headers like `Matric No` can map to a
saved `matric_number` field.

Windows OCR also cleans extracted cell text, validates values by field type, and
lowers confidence for suspicious cells. It repairs common low-resolution glyph
mistakes like `Matr1c N0`, `c0m`, `O8O`, and `R0dent`, and uses adaptive row
grouping plus center-based column matching for noisier spreadsheet screenshots.
The review workspace already highlights low-confidence values and now shows
validation issue text, so invalid email, phone, number, date, select,
multi-select, signature, or required-field values can be routed toward human
correction.

For form-layout extraction, Windows OCR matches labels using field keys, labels,
saved aliases, and common field terms, then captures same-line or nearby values.
Repeated label groups can become separate extracted form entries, so simple
membership or sign-in forms can flow into the same review table as attendance
rows. The form parser now also keeps wrapped multiline values in reading order
and can read left-side checkbox-style marks for signature fields. For saved
select fields, checkbox option groups can map the checked option into the
review value without including the unchecked options. Signature fields can also
use simple handwritten-looking stroke marks from the signature region as signed
values while preserving the mark's bounding box. When multiple options are
checked for a saved select field, CrowdLog preserves the checked labels as a
comma-separated value and flags the cell for review because the template field
is still single-select. For saved multi-select fields, the same checked option
group flow is valid: selected labels are preserved in reading order without the
single-select validation issue. Signature fields also detect adjacent split
stroke clusters in the signature region while ignoring blank underline-only
signature lines.

When OCR detects a likely missing sheet column, the review workspace can suggest
a new template field and re-extract the selected document after adding it.

## Next Phase

The invitation provider pass, standalone team-management route, PDF render hook,
first Windows form parser, generic HTTP OCR bridge, first Azure Document
Intelligence adapter, wrapped-value/signature-checkbox form OCR pass, first
select checkbox-group parser, first handwritten signature-region pass, first
production PDF hardening pass, richer multi-select checkbox preservation, true
multi-select template fields, split-stroke signature-region pass, and
provider-native PDF auto routing are complete for the current app shape. SMTP
can stay as an optional backlog item unless a deployment specifically needs it.

1. Continue production PDF OCR hardening, especially real deployment checks and
   richer failure diagnostics for direct-PDF cloud providers.
2. Add more vendor-specific OCR adapters, such as Google Document AI/Vision or
   AWS Textract, if a deployment needs them.
3. Continue broader form-layout OCR only when real sheets expose new layout
   patterns.

## Still Left To Build

- Additional vendor-specific cloud OCR adapters beyond Azure Document
  Intelligence and the generic HTTP OCR bridge.
- Broader form-layout OCR parsing beyond wrapped values, signature checkboxes,
  true multi-select checkbox groups, split signature stroke clusters, and simple
  signature-region marks.
- Further production PDF OCR hardening, especially vendor-specific fallback
  behavior.
- Editing existing events/templates instead of only creating new ones.
- SMTP transactional email delivery beyond the current
  console/file/http/Resend/Postmark/SendGrid invitation providers.
- Advanced analytics and reporting dashboards.
- Broader automated tests.
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
- PDF document extraction accepts a page range, can render selected pages to
  temporary PNG files with `pdftoppm`, and falls back to page-aware mock rows
  when rendering/provider extraction is unavailable
- PDF document extraction can skip rendering for full-document cloud OCR, checks
  renderer availability, and records render fallback reasons in raw OCR metadata
- Document extraction can request table-row or form-entry layout, with form-style mock fallback rows
- Windows OCR can parse first-pass form label/value layouts, normalize the
  extracted values by field type, include bounding boxes, and split repeated
  label groups into separate form entries
- Windows OCR form parsing can preserve wrapped multiline values in reading
  order and use nearby left-side checkbox marks for signature fields
- Windows OCR form parsing can map checked option groups into saved select-field
  values
- Windows OCR form parsing preserves multiple checked select options as
  reviewable comma-separated values with issue text
- Templates support true multi-select fields, the review UI edits them with
  checkbox controls, and Windows OCR treats multiple checked options as valid
  multi-select values
- Windows OCR form parsing can treat simple handwritten-looking marks in
  signature regions as signed values while preserving their bounding boxes
- Windows OCR form parsing can group split signature stroke fragments as signed
  values while leaving blank signature lines unsigned
- `OCR_PROVIDER="http"` can send a provider-neutral OCR payload with document
  metadata, base64 file content, template fields, and extraction options to
  `OCR_HTTP_ENDPOINT`; in `auto` mode, CrowdLog can try this HTTP OCR bridge
  before mock fallback when Windows OCR is unavailable
- `OCR_PROVIDER="azure"` can send local uploaded documents to Azure Document
  Intelligence, poll the async analyze result, map layout tables into saved
  template fields, preserve bounding boxes, return suggested fields for unmapped
  columns, and run before the generic HTTP bridge in `auto` mode when Azure is
  configured
- Uploaded documents can be replaced or deleted, with extracted rows and local files cleaned up
- OCR can suggest missing uploaded sheet columns, such as `taxa`
- Windows OCR can map columns using labels, keys, aliases, and common header variants
- Windows OCR can clean and validate extracted values by field type and lower confidence for suspicious cells
- Review cells show OCR validation issue text
- Focused OCR normalization, Windows form-layout, HTTP OCR provider, and Azure
  Document Intelligence provider tests can run with `npm run test:ocr`
- Windows OCR has low-resolution glyph cleanup and adaptive row/column grouping
- Local email sign-in/sign-out uses HTTP-only sessions
- Events, documents, extraction, and records are protected by owner/member access
- New events create an owner membership for the signed-in user
- Event responses include owner/reviewer memberships
- Owners can add and remove reviewers from the review workspace
- Owners can promote reviewers to owners and demote owners when another owner remains
- Review workspace has a fuller team-management panel with role counts,
  grouped owner/reviewer sections, joined dates, role menus, and reviewer
  removal controls
- Standalone team management lives at `/events/:eventId/team`, with member
  sign-in, role counts, grouped roster sections, owner-only add/remove controls,
  promotion/demotion controls, and links back to the review workspace
- Adding a new reviewer queues invitation email copy through a
  console/file/http/Resend/Postmark/SendGrid/off provider boundary
- The HTTP invitation provider posts a provider-neutral JSON payload to an
  external delivery endpoint and supports an optional bearer token
- The Resend invitation provider sends real reviewer invitation emails through
  the Resend email API with an idempotency key
- The Postmark invitation provider sends real reviewer invitation emails
  through the Postmark email API with optional message-stream routing
- The SendGrid invitation provider sends real reviewer invitation emails
  through the SendGrid Mail Send API with structured sender parsing
- Reviewer membership creation remains successful if invitation delivery fails
- Invitation links include `?eventId=...`, and the frontend opens invited events
  after sign-in when the account has access
- Owners manage reviewers, event deletion, templates, and suggested OCR fields
- Reviewers can access the event workspace and review extracted rows
- Approved/rejected rows track the reviewer and reviewed time for reporting
- Focused API tests cover auth sessions, protected guards, owner-only actions, reviewer invitation queuing, HTTP delivery behavior, Resend delivery behavior, Postmark delivery behavior, SendGrid delivery behavior, reviewer record access, document lifecycle cleanup, PDF page-range extraction options, PDF render-mode fallback behavior, form-style extraction options, Windows form-layout OCR parsing, HTTP OCR provider behavior, Azure Document Intelligence provider behavior, and OCR normalization
- Run the focused API suite with `npm run test:api`
- Review workspace has client-side search, status filters, summary counts, reporting panels, visible-row CSV export, and server-side full-event CSV/Excel export
- Portfolio case study and screenshot guide live in `docs/`
- `npm run seed:portfolio` creates an anonymized demo event for screenshot capture
- `npm run screenshots:portfolio` signs in to the seeded demo and captures the documented screenshot set with Chrome or Edge
- The five captured portfolio screenshots are stored in `docs/screenshots`

Current next phase:
The invitation provider pass, standalone team-management route, PDF render hook, first Windows form parser, generic HTTP OCR bridge, Azure Document Intelligence adapter, wrapped-value/signature-checkbox form OCR pass, select checkbox-group parser, simple signature-region mark handling, split-stroke signature-region parsing, first production PDF hardening pass, provider-native PDF auto routing, reviewable multi-select checkbox preservation, and true multi-select template fields are complete for now. Continue with OCR/document depth: real deployment checks, richer direct-PDF failure diagnostics, or additional vendor-specific adapters such as Google Document AI/Vision or AWS Textract if a deployment needs them. SMTP remains an optional backlog adapter only if a deployment needs it.

Please inspect the repo first, avoid reading .env secrets, then continue from the OCR/document depth phase.
```
