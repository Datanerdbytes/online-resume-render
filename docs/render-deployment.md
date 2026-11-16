# Render deployment

This repository is an isolated copy of `Datanerdbytes/online-portfolio` created
to host the application on [Render](https://render.com) after the original
Vercel project exhausted its Hobby plan. The original repository, its working
tree, and its Vercel project settings were not modified; future fixes can be
pulled from the original repo with `git pull <original-remote> main`.

## How it deploys

A [Blueprint](../render.yaml) at the repository root defines two Render web
services. Render re-applies the Blueprint on every push to `main`
(Blueprint sync), so a push both runs the CI checks in
[.github/workflows/ci.yml](../.github/workflows/ci.yml) and deploys the
updated commit. GitHub Actions no longer performs deployments on this
repository; CI verifies changes only.

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

   The three cross-service URLs are not known before the services exist; they
   can be entered as placeholders during creation and corrected with the
   literal `*.onrender.com` URLs afterwards (a follow-up commit can also pin
   them in `render.yaml`, which then syncs on push).

4. After creation, update `ADMIN_WEB_ORIGIN` and `WEB_APP_URL` with the
   services' actual URLs (visible on each service page).
5. In the **Neon Console**, enable Managed Auth on the branch and add the new
   `https://<web-service-url>.onrender.com` origin to its **trusted origins**.
   Without it, sign-in/registration from the Render domain fails; public
   portfolio pages work regardless. The API verifies JWTs against
   `NEON_AUTH_BASE_URL` only, so no API-side change is needed.

## Verifying the deployment

```bash
curl -s https://<api-service-url>.onrender.com/api/v1/health   # {"status":"ok"}
curl -s https://<api-service-url>.onrender.com/api/v1/ready    # 200 = database reachable
curl -sI https://<web-service-url>.onrender.com/               # 200, page renders
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

## Differences from the original repository

- `render.yaml` added; `docs/deployment.md` remains as the historical record
  of the Vercel pipeline this copy was cloned from.
- `.github/workflows/ci.yml` keeps all three check jobs (web, API, repository
  files) and drops the Vercel `deploy` job and its `production` environment
  gate; deployments are Render's Blueprint sync on push.
- `scripts/migrate-production.py` and `scripts/deployment-smoke.mjs` are
  Vercel/Neon-specific tools kept for reference; they are not part of the
  Render flow.
