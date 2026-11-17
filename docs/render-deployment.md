# Render deployment

This repository is an isolated copy of `Datanerdbytes/online-portfolio` created
to host the application on [Render](https://render.com) after the original
Vercel project exhausted its Hobby plan. The original repository, its working
tree, and its Vercel project settings were not modified; future fixes can be
pulled from the original repo (the `upstream` remote) with
`git pull upstream main`. Its push URL is disabled on purpose — pushes
belong only to `origin`, this deployment repository.

## How it deploys

A [Blueprint](../render.yaml) at the repository root defines two Render web
services. Deployments are driven entirely by the GitHub Actions pipeline in
[.github/workflows/ci.yml](../.github/workflows/ci.yml):

1. Every push to `main` (and every PR) runs the three check jobs: web checks
   (lint, typecheck, unit tests, production build), API checks (ruff, mypy,
   pytest including the PostgreSQL-backed integration and migration tests),
   and repository file checks (formatting, secret scan).
2. On `main`, the gated `Deploy production` job then runs behind the
   `production` GitHub environment (protected to `main`, requires reviewer
   approval — the same "Approve and deploy" flow as the original repository).
3. The deploy job calls the Render API to deploy the **exact pushed commit**
   to the API service first, then the web service, and polls each deploy
   until it reports `live` (any `*_failed`, `deactivated`, or `canceled`
   status fails the job).
4. A final smoke check verifies the live endpoints
   (`/api/v1/health`, `/api/v1/ready`, the web `/api/health` proxy, and the
   web landing page) before the run is reported successful.

The Blueprint sets `autoDeploy: false` on both services, so pushes never
trigger Render-side deploys on their own — GitHub Actions is the only deploy
path. PR previews are disabled per service in the Render dashboard
(Settings → PR Previews), keeping preview instances off the free-tier
instance-hour pool. The Blueprint itself still syncs on push, so config
changes in `render.yaml` (env values, plan, commands) apply without a code
deploy. The pipeline authenticates with the `RENDER_API_KEY` repository
secret; service IDs are committed in the workflow.

| Service             | Runtime     | Root dir   | Build                                | Start                                                        | Health check     |
| ------------------- | ----------- | ---------- | ------------------------------------ | ------------------------------------------------------------ | ---------------- |
| `online-resume-web` | Node 24     | repo root  | npm ci (workspaces) + `next build`   | `next start` (respects `PORT`)                               | `/`              |
| `online-resume-api` | Python 3.12 | `apps/api` | `pip install uv && uv sync --frozen` | `.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORT` | `/api/v1/health` |

Notes:

- `uv sync` includes the `dev` dependency group, which provides uvicorn; the
  runtime dependencies in `apps/api/pyproject.toml` alone do not include it.
- The database is the **existing Neon production database** shared with the
  (paused) Vercel deployment. The schema is already migrated, so no Alembic
  step is needed at deploy time. If a new database is ever used instead, run
  `uv run alembic upgrade head` from `apps/api` against that database once,
  before the API service starts.
- Media is stored in PostgreSQL (`MEDIA_STORAGE=database`) because Render
  free instances have no persistent disk, matching the Vercel configuration.
- `GET /api/v1/health` is a process-liveness check used by Render; it never
  claims database status. `GET /api/v1/ready` executes a real query and is the
  database readiness check.

## First-time setup (Render dashboard)

1. Push or verify `main` contains `render.yaml`.
2. In the Render dashboard: **New → Blueprint**, select the
   `Datanerdbytes/online-resume-render` repository (requires the Render GitHub
   app to be installed on it), and review the two planned services.
3. Fill in every variable marked `sync: false` when prompted. The values match
   the production configuration of the original Vercel projects
   (`online-portfolio` and `online-portfolio-api` under `datanerdbytes-4121`),
   which remain readable in the Vercel dashboard even while deployments are
   paused. Local fallbacks are listed where they exist; never commit the
   values to this repository.

   | Variable                   | Service | Source of value                                                                                                              |
   | -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
   | `ADMIN_WEB_ORIGIN`         | web     | `https://<web-service-url>.onrender.com` — exact origin, no trailing slash                                                   |
   | `API_BASE_URL`             | web     | `https://<api-service-url>.onrender.com`                                                                                     |
   | `NEON_AUTH_BASE_URL`       | web     | Vercel dashboard (frontend project) or `apps/web/.env.local`                                                                 |
   | `NEON_AUTH_COOKIE_SECRET`  | web     | Vercel dashboard (frontend project) or `apps/web/.env.local`                                                                 |
   | `DATABASE_URL`             | api     | Vercel dashboard (API project) or `apps/api/.vercel/.env.production.local` — Neon pooled URL, `postgresql+psycopg://` scheme |
   | `WEB_APP_URL`              | api     | `https://<web-service-url>.onrender.com`                                                                                     |
   | `NEON_AUTH_BASE_URL`       | api     | Vercel dashboard (API project) or `apps/api/.env`                                                                            |
   | `PUBLIC_PORTFOLIO_USER_ID` | api     | Vercel dashboard (API project)                                                                                               |
   | `GITHUB_PAT`               | api     | Vercel dashboard (API project) or `apps/api/.env`                                                                            |
   | `GITHUB_USERNAME`          | api     | Vercel dashboard (API project) or `apps/api/.env`                                                                            |
   | `NVIDIA_API_KEY`           | api     | Vercel dashboard (API project) or `apps/api/.env`                                                                            |
   | `NVIDIA_MODEL`             | api     | Vercel dashboard (API project) or `apps/api/.env`                                                                            |
   | `RESUME_IMPORT_ENABLED`    | api     | Vercel dashboard (API project) or `apps/api/.env`                                                                            |

   The three cross-service URLs are pinned as literal values in `render.yaml`
   (`https://online-resume-web.onrender.com`,
   `https://online-resume-api.onrender.com`); only the secrets remain
   dashboard-managed.

4. In the **Neon Console**, enable Managed Auth on the branch and add
   `https://online-resume-web.onrender.com` to its **trusted origins**.
   Without it, sign-in/registration from the Render domain fails; public
   portfolio pages work regardless. The API verifies JWTs against
   `NEON_AUTH_BASE_URL` only, so no API-side change is needed.

## Verifying the deployment

```bash
curl -s https://online-resume-api.onrender.com/api/v1/health   # {"status":"ok"}
curl -s https://online-resume-api.onrender.com/api/v1/ready    # 200 = database reachable
curl -sI https://online-resume-web.onrender.com/               # 200, page renders
```

Then check in a browser: landing page, `/resume`, and `/projects` render with
real data; the admin sign-in → edit → save → sign-out loop works on the new
origin after the Neon trusted-origins change.

## Free plan limits and upgrade path

Render's free plan grants a shared pool of 750 instance hours per workspace
per month. Services spin down after 15 minutes without traffic (about one
minute of cold start on the next request) and do not consume hours while spun
down. Two frequently visited services can exhaust the pool before the end of
the month, which suspends all free web services until it resets. If that
happens, upgrade one or both services to a paid compute plan in the Render
dashboard — no code or Blueprint changes are required.

## Free plan keep-alive

The API service cold-starts in 20-60 seconds, while the web app's first
server-side fetch attempt times out after 8 seconds. To keep a cold start
from breaking a visit, the web app's server-side API reads
(`fetchWakingApi` in `apps/web/src/lib/api.ts`) retry once after a short
pause with a 60-second timeout, so the page waits through the cold start
instead of rendering the "temporarily unavailable" fallback. The fallback
still appears if the API stays unreachable past that single wake attempt.

The active keep-alive is an external pinger: a free cron-job.org account
runs a job titled "keep-alive api" that requests
`https://online-resume-api.onrender.com/api/v1/health` every 10 minutes
(minutes 0, 10, 20, 30, 40, 50 UTC). Notes on that service:

- It times a request out after 30 seconds, so a single ping during a
  20-60 s cold start can be recorded as failed; that is expected and
  harmless because the wake-up still proceeds.
- cron-job.org auto-disables a job after 25 consecutive failures. The
  account has the failure email notification enabled as the safety net;
  if that email arrives, check the Render dashboard.

An always-on single service uses about 720 of the 750 free instance-hours;
the web service stays spun down when idle (waking in seconds on a visit),
so the pool is not exhausted.

`API keep-alive` (`.github/workflows/api-keep-alive.yml`) is retained as a
dormant backup pinger with the same 10-minute schedule. GitHub's scheduler
never created runs for it (verified across several schedule slots with the
workflow `active`, matching an open GitHub platform report), so it should
not be relied upon — but its manual "Run workflow" dispatch works and is
useful for testing. If cron-job.org ever goes away, re-enable or replace
its job there; the pinned URL above is the only value needed.

## Differences from the original repository

- `render.yaml` added; `docs/deployment.md` remains as the historical record
  of the Vercel pipeline this copy was cloned from.
- `.github/workflows/ci.yml` keeps all three check jobs (web, API, repository
  files) and has a Render-native `Deploy production` job behind the same
  `production` environment gate: it deploys the pushed commit via the Render
  API, polls deploy status, and smoke-checks the live services.
- Branch protection on `main` requires PRs and the three required check jobs;
  the repository allows squash merges only. CodeRabbit reviews PRs
  informationally (`request_changes_workflow: false`) and is not a required
  check or a merge blocker; conversation resolution is not required.
- `scripts/migrate-production.py` and `scripts/deployment-smoke.mjs` are
  Vercel/Neon-specific tools kept for reference; they are not part of the
  Render flow.
