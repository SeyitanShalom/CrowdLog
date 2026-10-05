# Vercel Deployment

CrowdLog deploys to Vercel as two projects:

1. `crowdlog-api` for the NestJS API in `apps/api`
2. `crowdlog-web` for the Next.js app in `apps/web`

The API uses Supabase PostgreSQL through `DATABASE_URL`. The web app proxies
API calls through same-origin routes, so sign-in cookies work cleanly from the
browser.

## Before Deploying

Commit and push the project to a Git provider connected to Vercel.

If the Git repository root is the parent folder that contains `crowdlog`, use
these root directories in Vercel:

```text
crowdlog/apps/api
crowdlog/apps/web
```

If the Git repository root is `crowdlog` itself, use:

```text
apps/api
apps/web
```

## API Project

Create a Vercel project for the API.

```text
Root Directory: crowdlog/apps/api
Framework Preset: Other
```

`apps/api/vercel.json` supplies the install, build, function, and routing
settings.

Set these API environment variables in Vercel:

```env
DATABASE_URL="your Supabase session-pooler connection string"
CORS_ORIGINS="https://your-web-project.vercel.app"
NODE_ENV="production"
```

Optional, mainly when calling the API directly from another domain:

```env
AUTH_COOKIE_SAMESITE="None"
```

OCR and email provider variables are only needed when you enable those providers.
Without cloud OCR credentials, use mock OCR behavior for deployment testing.

After the API env is set, run migrations against Supabase:

```bash
npm run db:deploy
```

## Web Project

Create a second Vercel project for the web app.

```text
Root Directory: crowdlog/apps/web
Framework Preset: Next.js
```

`apps/web/vercel.json` supplies the install and build commands.

Set this web environment variable:

```env
API_PROXY_URL="https://your-api-project.vercel.app"
```

Do not set `NEXT_PUBLIC_API_URL` unless you intentionally want the browser to
call the API domain directly.

## Smoke Checks

After both projects deploy:

```text
https://your-api-project.vercel.app/auth/me
```

should return:

```json
{"user":null}
```

Then open:

```text
https://your-web-project.vercel.app
```

Sign in with an email address, create an event, add fields, and save it.

## Upload Limitation

The current upload implementation stores files on local disk. Vercel serverless
functions only provide temporary filesystem storage, so uploads may disappear
between function instances. For a real production deployment, move uploaded
attendance sheets to Supabase Storage, S3, or another persistent object store.
