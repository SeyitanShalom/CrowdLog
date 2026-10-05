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
npm run smoke:ocr
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

Uploaded attendance sheets are stored in Supabase Storage. Create a private
bucket and set:

```env
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_STORAGE_BUCKET="attendance-uploads"
```

The API keeps returning `/uploads/:fileName` URLs and authorizes reads through
the existing authenticated route, while the file bytes live in the configured
Supabase bucket.

The repo includes a root `docker-compose.yml` for local PostgreSQL. If Docker is
installed, run this from the repo root:

```bash
docker compose up -d postgres
npm run db:migrate
```

## First API Routes

```text
GET  /health
GET  /health/ocr
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
GET  /events/:eventId/records/analytics
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

- `auto` uses local Windows OCR for uploaded image files on Windows, can send
  PDFs directly to Azure, Google Document AI, or an opted-in HTTP bridge, then
  falls back through the configured cloud providers and mock rows.
- `mock` always generates mock review rows.
- `windows` requires local Windows OCR and fails if it cannot run.
- `azure` sends uploaded document bytes to Azure Document Intelligence.
- `google` sends uploaded document bytes to Google Document AI.
- `http` posts a provider-neutral OCR request to `OCR_HTTP_ENDPOINT`.

Cloud OCR configuration:

```env
OCR_PDF_RENDER_MODE="auto"
OCR_PDF_RENDER_TIMEOUT_MS="60000"
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://your-resource.cognitiveservices.azure.com"
AZURE_DOCUMENT_INTELLIGENCE_KEY=""
AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID="prebuilt-layout"
AZURE_DOCUMENT_INTELLIGENCE_API_VERSION="2024-11-30"
AZURE_DOCUMENT_INTELLIGENCE_FEATURES=""
AZURE_DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS="1000"
AZURE_DOCUMENT_INTELLIGENCE_TIMEOUT_MS="60000"
GOOGLE_DOCUMENT_AI_PROJECT_ID=""
GOOGLE_DOCUMENT_AI_LOCATION="us"
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=""
GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION=""
GOOGLE_DOCUMENT_AI_ACCESS_TOKEN=""
GOOGLE_DOCUMENT_AI_ENDPOINT=""
GOOGLE_DOCUMENT_AI_FIELD_MASK=""
GOOGLE_DOCUMENT_AI_SKIP_HUMAN_REVIEW="true"
```

The Azure adapter submits the uploaded document bytes to the async analyze
endpoint, polls the operation result URL, maps layout table cells into the event
template fields, preserves bounding boxes, and can suggest fields for unmapped
table columns.

Google Document AI configuration uses `GOOGLE_DOCUMENT_AI_PROJECT_ID`,
`GOOGLE_DOCUMENT_AI_LOCATION`, `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`, and
`GOOGLE_DOCUMENT_AI_ACCESS_TOKEN`. Optional values include
`GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION`, `GOOGLE_DOCUMENT_AI_ENDPOINT`,
`GOOGLE_DOCUMENT_AI_FIELD_MASK`, and `GOOGLE_DOCUMENT_AI_SKIP_HUMAN_REVIEW`.
The Google adapter posts base64 `rawDocument` content to the online processing
API, carries PDF page ranges through `processOptions.individualPageSelector`,
maps table rows and form fields into saved template fields, preserves bounding
boxes, and can suggest fields for unmapped table columns.

For the generic HTTP OCR bridge, set `OCR_HTTP_DIRECT_PDF="true"` only when the
configured endpoint can read uploaded PDFs directly and should bypass page
rendering in `auto` mode.

For PDF uploads, `OCR_PDF_RENDER_MODE="auto"` first uses provider-native PDF OCR
when available, such as configured Azure Document Intelligence, configured
Google Document AI, or an HTTP bridge with `OCR_HTTP_DIRECT_PDF="true"`.
Otherwise it renders selected pages with `pdftoppm` when it is available. Set
`OCR_PDF_RENDER_MODE="full-document"` to force direct PDF OCR, or
`OCR_PDF_RENDER_MODE="render-pages"` to force page
rendering. When rendering is skipped or unavailable, the API records the render
mode, renderer, fallback reason, direct provider, page range, layout, and
provider result in raw OCR metadata.
`OCR_PDF_RENDER_TIMEOUT_MS` controls renderer availability checks and page
rendering.

When extraction fails, the uploaded document is marked `failed` and receives
sanitized diagnostic raw OCR metadata with the document, requested options, page
range, and error/cause messages. In `auto` mode, failed provider attempts are
preserved in the configured OCR wrapper when extraction later recovers through
another provider or mock fallback. Rendered PDF page OCR failures include the
failed page number, rendered page file name, requested page range, provider
name, and redacted provider error in those diagnostics.

`GET /health/ocr` is a read-only deployment check for OCR/PDF readiness. It
reports the selected provider mode, mock fallback setting,
Azure/Google Document AI/Google Vision/AWS Textract/HTTP configuration
booleans, direct-PDF support, `pdftoppm` availability, and the effective PDF
extraction path without exposing provider secrets or calling an external OCR
API.

For a credentialed provider smoke check, run `npm run smoke:ocr` after setting
`OCR_SMOKE_PROVIDER` to `azure`, `google`, `google-vision`, `aws-textract`, or
`http` and `OCR_SMOKE_FILE` to a local sample PDF or image. The script calls
the selected provider directly after building the API and prints row counts,
field coverage, confidence, issue counts, and suggested field metadata without
printing extracted cell values. Set `OCR_SMOKE_SUMMARY_FILE` to also save that
sanitized summary as a JSON artifact for comparing repeated provider runs.

For final deployment validation, set `OCR_SMOKE_RUNS_JSON` to a JSON array of
runs and use the same command. Each run can define `name`, `provider`, `file`,
`fileType`, `layout`, `rowCount`, `pageStart`, `pageCount`, `totalPages`,
`requireRows`, `fields`, and `summaryFile`. Set
`OCR_SMOKE_MATRIX_SUMMARY_FILE` for a sanitized aggregate summary and
`OCR_SMOKE_CONTINUE_ON_ERROR="true"` to attempt every provider while recording
redacted failure diagnostics.

Optional smoke-check variables:

```env
OCR_SMOKE_FILE_TYPE="application/pdf"
OCR_SMOKE_LAYOUT="table"
OCR_SMOKE_ROW_COUNT="10"
OCR_SMOKE_PAGE_START="1"
OCR_SMOKE_PAGE_COUNT="1"
OCR_SMOKE_TOTAL_PAGES=""
OCR_SMOKE_REQUIRE_ROWS="true"
OCR_SMOKE_FIELDS_JSON='[{"label":"Name","key":"name","type":"text","required":true}]'
OCR_SMOKE_SUMMARY_FILE=".tmp/ocr-smoke/azure-summary.json"
OCR_SMOKE_RUNS_JSON='[{"name":"Azure table","provider":"azure","file":"./samples/sheet.pdf","summaryFile":".tmp/ocr-smoke/azure.json"},{"name":"Vision image","provider":"google-vision","file":"./samples/sheet.png"}]'
OCR_SMOKE_MATRIX_SUMMARY_FILE=".tmp/ocr-smoke/matrix-summary.json"
OCR_SMOKE_CONTINUE_ON_ERROR="true"
```

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

For `layout: "form"` extraction, Windows OCR can parse label/value layouts,
keep wrapped multiline values in reading order, split repeated form entries, and
use nearby left-side checkbox marks such as `X` for signature fields when a form
uses checkbox-style signing. For saved `select` fields with configured options,
checked option groups such as `X Present` can map the selected option into the
review value without including unchecked options. When multiple options are
checked for a saved select field, Windows OCR preserves the checked option
labels as a comma-separated value and adds issue text for review because the
template field is still single-select. For saved `multi_select` fields, the
same checkbox-group extraction is valid and does not add the single-select issue
text. Signature fields can also use simple stroke-like marks found in the
signature region as signed values while preserving the mark bounding box. Split
stroke clusters, such as an angled slash plus a short baseline, can also count
as signed values; plain blank signature lines remain unsigned.

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
