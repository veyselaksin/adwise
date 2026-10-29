# ADWISE: Ad Performance Tool

An internal tool for Livensa's marketing team. It is a read-only dashboard of Meta and TikTok ad
performance with an AI agent built in, and it was built as the Feraset take-home case.

The team opens it every morning to see spend, installs, trials, subscriptions, CAC and D7 ROAS by
channel, country, campaign, ad set and ad. They can ask the agent questions in plain English
("What was CAC by country last week, Meta vs TikTok?"), and every answer is computed by the same
services the dashboard uses, so the dashboard and the agent always give the same number.

## Contents

- [Architecture](#architecture)
- [Tech stack and why we chose it](#tech-stack-and-why-we-chose-it)
- [Quick start](#quick-start)
- [Credentials and authentication](#credentials-and-authentication)
- [Environment variables](#environment-variables)
- [API documentation (Swagger / OpenAPI)](#api-documentation-swagger--openapi)
- [API reference](#api-reference)
- [Features](#features)
- [Domain rules: metric definitions](#domain-rules-metric-definitions)
- [Security](#security)
- [Testing and quality gates](#testing-and-quality-gates)
- [Deployment (Docker / Dokploy)](#deployment-docker--dokploy)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
                 browser (marketing team)
                          │  httpOnly "session" cookie
                          ▼
 ┌────────────────────────────────────────────┐
 │ apps/dashboard: Next.js 16 (App Router)    │  :3000 in dev
 │ React 19, Tailwind 4, shadcn/ui, recharts  │
 │ server-only lib/api.ts: the browser never  │
 │ sees the API URL or the JWT                │
 └────────────────────┬───────────────────────┘
                      │  Authorization: Bearer <JWT>
                      ▼
 ┌────────────────────────────────────────────┐        ┌──────────────────────┐
 │ apps/server: Fastify 5 + TypeBox           │──SSE──▶│ ZenMux (LLM gateway) │
 │ route → controller → service → repository  │        │ DeepSeek / GLM / GPT │
 │ OpenAPI docs at /docs, MCP at /mcp/<secret>│        └──────────────────────┘
 └───────┬───────────────────────────┬────────┘
         │ read-only                 │ read/write (its own files only)
         ▼                           ▼
  case SQLite (DB_PATH)        apps/server/data/
  via Prisma + better-sqlite3    team-rules.json, pinned-tiles.json,
  + CASE_DIR (glossary,          insights.json, telemetry.db (node:sqlite)
  team notes, build logs)
```

- **pnpm workspace** with two apps and no shared package yet.
- **Server layering.** Routes declare the path and schema, controllers map the request to a
  service call, services hold the business rules, and repositories are the only code that runs SQL.
- **One response envelope** everywhere: `{ "success": true, "message", "data" }` or
  `{ "success": false, "message", "error": { "code" } }`.
- **The case data is read-only.** The SQLite file is opened read-only through Prisma's
  better-sqlite3 adapter, and nothing ever migrates or writes it.
- **"Today" is 2026-10-15** for anything date-relative in the case data. Yesterday, 2026-10-14,
  is the last day in the data. Observability telemetry uses real wall-clock time.

## Tech stack and why we chose it

The guiding constraints were: an **internal tool** for a small team, **read-only** case data in a
single SQLite file, an **AI agent that must give the same numbers as the dashboard**, a short build
window, and a cheap, single-host deployment. Each choice below follows from those.

### At a glance

| Layer | Choice (version) | Why, in one line |
| --- | --- | --- |
| Runtime | Node.js 26.12.1 | One language end to end; built-in `node:sqlite`, `node:test` and fetch mean fewer dependencies |
| Language | TypeScript 5.9 (strict, no `any`) | Metric math and API contracts are typed end to end |
| Monorepo | pnpm 12 workspace | Two apps, one lockfile, strict dependency isolation, opt-in install scripts |
| API framework | Fastify 5.12 | Fast, schema-first, plugin-based, first-class OpenAPI |
| Validation and schemas | TypeBox 1.4 | One schema gives runtime validation, TS types and the OpenAPI spec |
| Data access | Prisma 7.10 + better-sqlite3 adapter | Typed queries over the case DB, opened **read-only** |
| App storage | JSON files + `node:sqlite` | The server's own small state; no database server to run |
| Auth | @fastify/jwt, @fastify/cookie | Stateless 12 h JWTs; httpOnly cookies in the dashboard |
| Hardening | @fastify/helmet, @fastify/rate-limit, @fastify/cors | Security headers, per-route limits, one allowed origin |
| API docs | @fastify/swagger + swagger-ui | Docs generated from the code, so they can't drift |
| LLM access | ZenMux (OpenAI-compatible) over plain `fetch` + SSE | One key, several models, no SDK lock-in |
| ChatGPT | @modelcontextprotocol/sdk 1.32 | The same agent tools exposed to ChatGPT as a connector |
| Logging | pino (Fastify's logger) | Structured JSON logs; one hook feeds Observability |
| Web framework | Next.js 16.4 (App Router) + React 19.3 | Server Components keep the API and tokens off the browser |
| Styling / UI | Tailwind CSS 4 + shadcn/ui (Base UI) | Accessible components we own, themable, dark mode via tokens |
| Charts | Recharts 3.8 | Declarative React charts that fit shadcn's chart wrapper |
| Agent text | react-markdown + remark-gfm | Agent answers render tables and lists safely, no raw HTML |
| Exports | pdfkit, write-excel-file | PDF and Excel reports generated server-side |
| Icons, toasts, theme | lucide-react, sonner, next-themes | Small and standard in the shadcn ecosystem |
| Tests | `node:test` + Fastify `app.inject` | No test framework to install; HTTP-level tests without a port |
| Lint | ESLint 9 (typescript-eslint, eslint-config-next) | One linter, flat config, React hooks rules |
| Deploy | Docker multi-stage + docker-compose on Dokploy | Self-hosted, a single host, a persistent volume for app data |

### Backend

**Fastify instead of Express or NestJS.** Fastify is schema-first: every route declares its
body, query, params and responses, and Fastify uses those schemas to validate input, serialize
output quickly, and generate the OpenAPI spec. That gives us the strict `{success, message,
data|error}` envelope and the Swagger docs almost for free. Its plugin and decorator model
(`app.authenticate`, `app.services`, `app.telemetry`) keeps cross-cutting concerns out of the routes.
Express would need hand-written validation and docs. NestJS adds decorators, dependency injection and
a lot of structure that a 30-endpoint internal API doesn't need.

**TypeBox instead of Zod or JSON Schema by hand.** A TypeBox schema *is* JSON Schema, so
Fastify validates it natively with Ajv and swagger renders it directly. `Static<typeof X>` gives
the TypeScript type. One definition gives three things: validation, types and docs. The agent's tool
parameters are TypeBox too, reduced to plain JSON Schema for the model. So the shapes the LLM sees,
the shapes the API validates and the shapes the dashboard gets all come from the same source.

**Prisma over the case's SQLite, read-only.** The case ships a SQLite file we must never modify.
Prisma 7's driver adapters let us open it through **better-sqlite3 in read-only mode** and still
get a typed client generated from a hand-written `schema.prisma`. The Prisma config deliberately has
no database URL, so `migrate`, `db push` and `db pull` can't run by accident. Aggregations that
Prisma can't express (grouped metric sums) use `$queryRaw` with bound parameters, inside
repositories only.

**SQLite and JSON files for the server's own state, not Postgres.** The server writes very little:
team rules (≤ 50), pinned tiles (≤ 12), insights (≤ 500), and observability telemetry. JSON files with
queued, atomic writes are enough for the first three. Telemetry needs indexes and range queries, so
it uses **Node's built-in `node:sqlite`** (WAL mode, versioned migrations), which needs no extra
dependency. Everything lives in one volume (`apps/server/data`). The trade-off, documented under
Deployment, is that this is single-instance storage. Moving to several replicas would mean swapping
these repositories for Postgres, behind the same service interfaces.

**One metrics engine shared by the dashboard and the agent.** This is an architecture choice more
than a library one, and it drove the layering: `MetricsService` implements the glossary's
definitions (CAC = spend ÷ subscriptions, maturity, ratios from sums) once. The dashboard calls it
through `/metrics/query`, and the agent calls it through the `query_metrics` tool. The two can't
disagree, because there is no second implementation to drift.

**ZenMux over plain `fetch`, not a vendor SDK.** ZenMux is one OpenAI-compatible gateway in front
of DeepSeek, GLM and OpenAI models, so one API key lets the team switch between a cheap default and
a frontier model. We call it with `fetch` and parse the SSE stream ourselves, with retry and backoff on
429 and 5xx responses, a timeout, and cancellation when the user disconnects. That keeps the dependency
surface small and gives us the raw `usage` block (tokens and the billed `cost`) that Observability
reports. **DeepSeek V4.1 Flash is the default** because it's fast and cheap enough to use freely
for everyday questions. GPT 6.1 Sol is there for harder questions.

**MCP SDK for ChatGPT.** Many of the team already work in ChatGPT. The official
Model Context Protocol SDK exposes the *same* tools over Streamable HTTP, so ChatGPT can answer from
the same numbers with no extra model cost on our side.

**pino logging.** It's Fastify's built-in logger: structured JSON, request ids, and cheap. A single
`logMethod` hook persists warnings, errors and run events (after redaction) for Observability, with no
separate logging pipeline.

**`node:test` + `app.inject`.** Tests build the real app and send HTTP requests in memory (no open
port), against the real read-only case DB, with a scripted fake model for the agent. The test runner
ships with Node, so there's no Jest or Vitest configuration or version churn. The suite runs in seconds.

### Frontend

**Next.js 16 App Router with React 19 Server Components.** The most important requirement on the
frontend is that **the API URL and the JWT never reach the browser**. With Server Components, data
loading happens on the server: `lib/api.ts` is marked `server-only`, reads the httpOnly `session`
cookie and calls the API. The browser only receives rendered HTML and typed props. `proxy.ts` gates
every route behind the session. `cacheComponents` and `<Suspense>` let the page shell render
instantly while the data streams in. Client components are kept small and used only for
interactivity: filters, charts and the agent chat. Route handlers (`/export`, `/agent/*`,
`/observability/runtime`) act as thin server-side proxies for the few things the browser needs to
fetch or stream.

**Tailwind CSS 4 + shadcn/ui (Base UI primitives).** shadcn copies accessible components *into*
the repo instead of hiding them in a dependency, so they're ours to adapt. Base UI provides the
keyboard and ARIA behaviour of selects, dialogs and menus. Theme tokens (`bg-background`,
`text-muted-foreground`, chart series variables) make light and dark mode work everywhere with
no per-component colors. Tailwind 4 needs no config file and builds fast with Turbopack.

**Recharts.** Declarative, composable React charts. It's what shadcn's `chart` component wraps, so
tooltips, legends and colors follow the same theme tokens as the rest of the UI.

**react-markdown + remark-gfm** render the agent's answers (tables, lists, emphasis) without
`dangerouslySetInnerHTML`, so model output can't inject HTML.

**pdfkit and write-excel-file** generate PDF and Excel exports on the server (in the `/export`
route) from the same data as the screen. They're small, pure-JS libraries with no headless browser.

### Tooling and delivery

**pnpm workspace.** Two apps share one lockfile and one `pnpm install`, with a strict
`node_modules` (no phantom dependencies). Its `allowBuilds` list means **no package runs an install
script unless we've reviewed it**: only esbuild and better-sqlite3 are allowed. The pinned
`packageManager` and `engine-strict` with `.nvmrc` mean every machine and CI run uses the same toolchain.

**TypeScript strict everywhere,** with `typecheck`, `lint`, `test` and `build` as the definition of
done. Metric formulas, API contracts and the agent's tool arguments are all checked at compile time.

**Docker + docker-compose on Dokploy.** Multi-stage images (build → production dependencies only →
a slim runtime as the non-root `node` user, with a health check). Dokploy gives a self-hosted, Heroku-like
deploy on one VPS: environment variables in its UI, a domain with TLS, and a named volume for the server's
data. The case folder is mounted read-only from the host, so the case data is never baked into an image.

## Quick start

Prerequisites:

- **Node v26.12.1** (pinned in `.nvmrc`; `engine-strict` blocks older versions), so run `nvm use`.
- **pnpm 12** (`corepack enable` or `npm i -g pnpm@12`). Never use npm or yarn in this repo.
- **The unzipped case folder** (`ad-performance-tool-case/`), kept *outside* the repo.
- Optional: a **ZenMux API key** for the agent. Without one, everything except the agent and the
  investigation's interpretation works.

```bash
nvm use
pnpm install

cp apps/server/.env.example apps/server/.env
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

Then edit `apps/server/.env`:

1. Set `DB_PATH` to the case's `data/livensa.db` and `CASE_DIR` to the case folder (absolute paths).
2. Generate the two secrets: `openssl rand -base64 48`, once for `JWT_SECRET` and once for `COOKIE_SECRET`.
3. Choose passwords (8+ characters) for `APP_PASSWORD` (the dashboard) and `DOCS_PASSWORD` (Swagger).
4. Optionally paste your own `ZENMUX_API_KEY`.

```bash
pnpm dev
```

| What | URL | Sign in with |
| --- | --- | --- |
| Dashboard | http://localhost:3000 | `APP_USER` / `APP_PASSWORD` |
| API | http://localhost:4000 | `POST /auth/login`, then `Authorization: Bearer <token>` |
| API docs (Swagger UI) | http://localhost:4000/docs | `DOCS_USER` / `DOCS_PASSWORD` |
| OpenAPI JSON | http://localhost:4000/docs/json | the docs session, or HTTP Basic with the docs credentials |
| Health | http://localhost:4000/health | public |

The server validates its environment at startup and **refuses to boot** with a clear message if a
value is missing or weak (for example a secret under 32 characters, or a password under 8).

## Credentials and authentication

There are **three separate sign-ins**, each with its own credentials. All of them are set in
`apps/server/.env` (locally) or in Dokploy's Environment tab (in production).

> **The real values are deliberately not in this README.** Only `*.example` env files are
> committed, and secrets never go in the repo or the browser. Reviewers get the deployed
> credentials out-of-band (e.g. with the case submission). The `.env.example` defaults
> (`marketing` / `docs` with `change-me-please`) are placeholders for local use only.

### 1. Marketing dashboard (the team's sign-in)

| | |
| --- | --- |
| Username | `APP_USER` (example default: `marketing`) |
| Password | `APP_PASSWORD` (min. 8 characters) |
| Where | `/login` on the dashboard |
| Model | One shared team account. There is no per-user data model, so everyone signed in sees the same data. |

How it works:

1. The login form posts to a Next.js server action, which calls the API's `POST /auth/login`.
2. The API compares username and password in constant time, checking both even if the username
   is wrong so timing doesn't reveal which one failed. It issues a **JWT signed with
   `JWT_SECRET`, valid for 12 hours**.
3. The dashboard stores that JWT in an **httpOnly cookie named `session`** (`SameSite=Lax`, `Secure`
   in production, expiring with the token). Browser JavaScript can't read it.
4. `proxy.ts` (Next's request gate) redirects any request without a session to
   `/login?next=<original path>`. Server components send the token to the API from server-only code.
5. When the token expires, the API answers `401` and the user is sent back to sign in.
6. Login is rate-limited to **10 attempts per minute** per client (`429 RATE_LIMITED` beyond that).

### 2. API (JWT bearer token)

Every endpoint except `GET /health` and `POST /auth/login` needs a bearer token:

```bash
# Sign in (same credentials as the dashboard)
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"marketing","password":"<APP_PASSWORD>"}' | jq -r .data.token)

# Call any endpoint
curl -s http://localhost:4000/metrics/query \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"preset":"last_week","metrics":["spend","subscriptions","cac"],"dimensions":["country","channel"]}'
```

The login response is `{ "token", "expiresIn": 43200, "user" }`. A missing, expired or tampered
token gets `401 UNAUTHORIZED`.

### 3. API docs (Swagger UI)

| | |
| --- | --- |
| Username | `DOCS_USER` (example default: `docs`) |
| Password | `DOCS_PASSWORD` (min. 8 characters) |
| Where | `/docs/login` on the API; sign out at `/docs/logout` |
| On/off | `DOCS_ENABLED` (`true` by default locally; **`false` by default in docker-compose**) |

- The docs sign-in sets a signed, httpOnly `docs_session` cookie (signed with `COOKIE_SECRET`,
  `SameSite=Strict`, limited to `/docs`, 8 hours).
- Scripts can skip the page and use **HTTP Basic auth** instead: `curl -u docs:<DOCS_PASSWORD> http://localhost:4000/docs/json`.
- The docs sign-in is a separate gate from the API's JWT. To *try* endpoints in Swagger UI, call
  `POST /auth/login` there with the dashboard credentials, click **Authorize**, and paste the
  token. `persistAuthorization` keeps it across reloads.
- Failed docs sign-ins are logged (username only) and rate-limited to 10 per minute.

### 4. ChatGPT connector (MCP), optional

There is no username or password here. The endpoint lives at an unguessable path,
`/mcp/<MCP_SECRET>` (32+ URL-safe characters, `openssl rand -hex 32`). ChatGPT connectors only
support OAuth or no auth, so the path is the protection. It's hidden from `/docs`, a wrong secret
gets a plain `404`, and an empty `MCP_SECRET` turns the endpoint off entirely. Rotate the secret if
the URL leaks.

### 5. ZenMux API key (server → model provider)

`ZENMUX_API_KEY` is one key for every agent model. Each developer adds their own to their own
`.env`. It's never committed, never sent to the browser, never logged, and it's redacted from
stored telemetry.

## Environment variables

### Server (`apps/server/.env`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOST` | | `0.0.0.0` | Listen address |
| `PORT` | | `4000` | Listen port (`4001` in Docker) |
| `LOG_LEVEL` | | `info` | pino level: `fatal`…`trace`, `silent`. Also decides which logs reach Observability. |
| `NODE_ENV` | | `development` | `production` turns on `Secure` cookies |
| `CORS_ORIGIN` | | `http://localhost:3000` | The dashboard origin allowed by CORS |
| `JWT_SECRET` | **yes** | | Signs session JWTs (and, derived, insight snapshots). 32+ characters. |
| `COOKIE_SECRET` | **yes** | | Signs the docs session cookie. 32+ characters. |
| `DOCS_ENABLED` | | `true` | Serve Swagger UI at `/docs` |
| `DOCS_USER` / `DOCS_PASSWORD` | **yes** | | Docs sign-in. Password 8+ characters. |
| `APP_USER` / `APP_PASSWORD` | **yes** | | Dashboard / API sign-in. Password 8+ characters. |
| `DB_PATH` | **yes** | | The case SQLite file, opened read-only |
| `CASE_DIR` | **yes** | | The case folder: `glossary.md`, `team-notes.md`, `build-logs/` |
| `RULES_PATH` | | `data/team-rules.json` | Team rules (written by the server) |
| `PINS_PATH` | | `data/pinned-tiles.json` | Pinned overview tiles |
| `INSIGHTS_PATH` | | `data/insights.json` | Saved insights |
| `TELEMETRY_PATH` | | `data/telemetry.db` | Observability store (runs, spans, logs) |
| `TELEMETRY_RETENTION_DAYS` | | `30` | Telemetry kept for 1–365 days |
| `ZENMUX_API_KEY` | | empty | The agent's model key. Empty turns the agent off and leaves the rest working. |
| `AGENT_MODEL` | | `deepseek/deepseek-v4.1-flash` | Default model: `deepseek/deepseek-v4.1-flash`, `z-ai/glm-5.2` or `openai/gpt-6.1-sol` |
| `MCP_SECRET` | | empty | Enables `/mcp/<secret>` for ChatGPT. 32+ of `[A-Za-z0-9_-]`. |

Relative paths are resolved from `apps/server`.

### Dashboard (`apps/dashboard/.env.local`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_URL` | `http://localhost:4000` | The Fastify API. Read **server-side only**, never exposed to the browser. |

The dashboard has no `NEXT_PUBLIC_*` variables, and none may ever hold a secret.

## API documentation (Swagger / OpenAPI)

The OpenAPI 3.1 spec is **generated from the route schemas**: the same TypeBox schemas that
validate requests and serialize responses. The docs can't drift from the code.

- **Swagger UI:** `http://localhost:4000/docs`, behind the docs sign-in (see above). It has a
  branded theme, every tag expanded as a list, and deep links.
- **Raw spec:** `GET /docs/json` (or `/docs/yaml`), using the docs session or HTTP Basic auth.
- **Security scheme:** `bearerAuth` (HTTP bearer, JWT). Protected operations are marked with it,
  and each one documents its `401`.
- **Every operation documents** its summary and description, query, path and body schemas with
  examples, its success schema, and its error responses (`400 VALIDATION_ERROR`, `401`, `404`,
  `409`, `429`, `503` where they apply), all using the shared `ErrorResponse` envelope.
- **Tags:** `health`, `auth`, `metrics`, `budgets`, `releases`, `anomalies`, `agent`,
  `investigations`, `rules`, `pins`, `insights`, `observability`.
- **Hidden on purpose:** the docs login/logout pages and the MCP endpoint (its path is a secret).
- In production, docker-compose sets `DOCS_ENABLED=false` unless you turn it on.

Trying an endpoint in Swagger UI:

1. Open `/docs` and sign in with `DOCS_USER` / `DOCS_PASSWORD`.
2. Expand **auth → POST /auth/login**, click **Try it out**, and enter `APP_USER` / `APP_PASSWORD`.
3. Copy `data.token`, click **Authorize** (top right), paste it, and confirm.
4. Every protected endpoint now works from the UI.

## API reference

All 32 operations, taken from the generated spec. Everything except the first two needs the JWT.
Money is USD, dates are `YYYY-MM-DD` (UTC).

**Rate limits:** 300 requests per minute per client globally. Stricter limits apply to login
(10/min), agent chat (10/min), investigations (10/min) and MCP (60/min). Over the limit, the
response is `429 RATE_LIMITED`.

| Method | Path | Tag | What it does |
| --- | --- | --- | --- |
| GET | `/health` | health | Liveness: status, version, uptime (public) |
| POST | `/auth/login` | auth | Exchange `APP_USER`/`APP_PASSWORD` for a 12 h JWT (public) |
| GET | `/metrics/catalog` | metrics | Metric definitions, formulas, maturity, units, the data calendar |
| POST | `/metrics/query` | metrics | The one metrics engine: metrics × dimensions × filters × period, with totals (the blended number) and per-row maturity |
| GET | `/entities` | metrics | Campaigns, ad sets and ads (for filters and lookups) |
| GET | `/brief` | metrics | The morning brief: fixed checks over yesterday, budgets and releases |
| GET | `/budgets/pacing` | budgets | Each ad set's average daily spend vs its daily budget |
| GET | `/releases` | releases | App releases parsed from the case's build logs |
| GET | `/anomalies` | anomalies | Campaign anomaly monitor (robust z-scores, no model) |
| GET | `/agent/models` | agent | Models the agent can use, and whether the agent is configured |
| POST | `/agent/chat` | agent | Ask the agent; streams NDJSON events (steps, tool calls, answer, usage) |
| POST | `/investigations` | investigations | Explain a campaign's period-over-period change; streams stages |
| GET | `/rules` | rules | List team rules |
| POST | `/rules` | rules | Add a rule (max 50, 500 characters each) |
| PATCH | `/rules/{id}` | rules | Edit a rule or switch it on/off |
| DELETE | `/rules/{id}` | rules | Delete a rule |
| GET | `/pins` | pins | List pinned overview tiles |
| POST | `/pins` | pins | Pin an agent lookup (its `query_metrics` call) to the overview |
| GET | `/pins/{id}/result` | pins | Re-run a pinned tile on today's data |
| DELETE | `/pins/{id}` | pins | Unpin |
| GET | `/insights` | insights | List saved insights (search, sort, page) |
| POST | `/insights/preview` | insights | Preview an insight from a signed answer snapshot |
| POST | `/insights` | insights | Save an agent answer as a frozen report |
| GET | `/insights/{id}` | insights | Open an insight, with its evidence |
| PATCH | `/insights/{id}` | insights | Rename an insight |
| DELETE | `/insights/{id}` | insights | Delete an insight |
| GET | `/observability/summary` | observability | Agent-run KPIs with a previous-window comparison |
| GET | `/observability/timeseries` | observability | Runs, durations, tokens and cost over time |
| GET | `/observability/runs` | observability | Search, filter, sort and page runs |
| GET | `/observability/runs/{id}` | observability | One run's trace (by run id or trace id) |
| GET | `/observability/logs` | observability | Search persisted server logs (keyset paging) |
| GET | `/observability/runtime` | observability | This process's memory, CPU, event loop and checks |

Not in the spec: `POST /mcp/<MCP_SECRET>` (ChatGPT connector, see below), plus `/docs/login`
and `/docs/logout`.

Example error:

```json
{ "success": false, "message": "Wrong username or password", "error": { "code": "INVALID_CREDENTIALS" } }
```

## Features

### 1. Overview dashboard (`/`)

The page the team opens every morning.

- **Filter bar:** period presets matching the team's named periods (yesterday, last 7/14/28 days,
  last week, this week, this month, last month) or a custom range; channel (Meta, TikTok);
  country (US, GB, DE, BR); and a split of the trend by channel or country. Filters live in the
  URL, so any view can be shared as a link.
- **KPI grid:** spend, installs, trials, subscriptions, CPI, cost per trial, CAC, trial→sub,
  D7 ROAS and CTR, each with the change against the previous equal-length period. Figures that
  **aren't final yet** (e.g. CAC for days under 4 days old) are labelled as provisional, not hidden.
- **Trend chart:** daily metrics over the period, with non-final days marked.
- **Country table:** channels compared **within each country first**, then the blended total,
  as the team notes require.
- **Drill-down table:** campaign → ad set → ad.
- **Morning brief:** fixed, model-free checks over yesterday. Campaigns whose cost per trial moved
  more than 20% against last week, or whose final-day CAC moved 15%+ week over week, are called
  out, but only with 20+ trials or subscriptions so noise isn't news. It also covers budget pacing
  outliers and releases in the last 7 days, shows up to 8 items and counts the rest.
- **Pinned tiles:** lookups pinned from agent answers (up to 12). They re-run against the data on
  every visit, so they never go stale.
- **Anomaly overview:** the top flags from the anomaly monitor.
- **Export:** the current view as **PDF, Excel (xlsx), CSV, JSON or Markdown**. It covers the
  KPIs, daily series, countries, campaigns, ad sets and ads, built from the same numbers on screen.

### 2. The AI agent (ADWISE)

A side panel on every page. It answers questions about the ad data in plain language.

- **Grounded in tools, not memory.** The agent can only answer through six tools over the same
  services as the dashboard:
  - `query_metrics`: any metrics × dimensions × filters × period;
  - `list_entities`;
  - `get_budget_pacing`;
  - `get_releases`;
  - `get_anomalies`;
  - `export_report`: offers a file in one of the export formats.
- **Follows the team's conventions.** The system prompt includes the case's `glossary.md` and
  `team-notes.md` verbatim, the data calendar (today = 2026-10-15), maturity rules, and the
  team's own **rules** (see below).
- **Streaming.** Answers stream as NDJSON: each step (with a readable label such as "CAC by
  channel · last week"), tool calls, the answer text, suggested follow-ups (up to 3), and token usage.
- **Models:** DeepSeek V4.1 Flash (default, fast and cheap), GLM 5.2, and GPT 6.1 Sol (slower and
  more expensive). All go through **ZenMux**, one OpenAI-compatible endpoint, with retry and
  backoff on 429 and 5xx responses.
- **Bounded:** at most 6 model calls per question (the last one must answer), 2,000-character
  questions, 60 messages of history. Older turns are shortened to the question and the answer's
  lead sentence.
- **From an answer you can** copy it, **pin** a lookup to the overview, or **save it as an
  insight**.
- With no `ZENMUX_API_KEY`, the panel says the agent isn't configured and the rest of the app
  works normally.

### 3. Team rules (`/rules`)

Standing instructions the team gives the agent, for example "Always report CAC by country before
the blended number". Rules can be added, edited, switched on/off and deleted (up to 50, 500
characters each). Active rules are appended to the agent's prompt on every question. They're stored
in `RULES_PATH` with queued, atomic writes.

### 4. Saved insights (`/insights`)

Turn an agent answer into a **frozen report** the team can share by link.

- When an answer finishes, the server hands back a **signed snapshot** of the answer and the
  evidence the agent read. The signature uses a key derived from `JWT_SECRET`, valid for 24 hours.
  Saving verifies the signature, so a saved insight can't be edited to show numbers the agent
  never produced.
- The list has search, newest/oldest sorting and paging, and holds up to 500 insights.
- An insight page shows the question, the answer, and its evidence (the tool calls and their
  results).
- Insights can be renamed and deleted, with a copy-link button.

### 5. Campaign investigations (`/investigate`)

"Why did this campaign's performance change?"

1. Pick a campaign and a period (up to 90 days). The previous equal period must also be in the data.
2. **Compute facts** (no model): every metric for both periods (spend, impressions, clicks, CTR,
   CPC, installs, CPI, trials, subscriptions, CAC, D7 ROAS…), the biggest movers among ad sets and
   ads (top 8), releases in the window, and maturity.
3. **Interpret facts:** one model call turns the facts into findings, next steps and limitations,
   as structured JSON.
4. **Guardrails:** every figure the model cites is checked against the computed facts. Unverifiable
   claims are dropped, and there are no best/worst calls under 20 subscriptions (team note 6).
   Malformed JSON gets one retry; after that, the report ships with facts only.
5. The report streams stage by stage. With no model configured, you still get the full facts.

Limited to 10 investigations per minute.

### 6. Anomaly monitor (`/anomalies`)

Flags unusual days per campaign **without any model**, so it works even when the provider is down.

- **Rules:** spend spike, spend drop, CAC increase, D7 ROAS decrease, CTR decrease, CPC increase,
  and "conversions down while spend held".
- **Method:** a robust z-score, `(value − baseline median) ÷ (1.4826 × MAD)`. The baseline is the
  previous 28 days, comparing weekdays with weekdays and weekends with weekends. A flag needs a
  score ≥ 3 *and* a minimum relative change *and* enough volume for its rule (e.g. 2,000
  impressions for CTR, 5 subscriptions for CAC).
- **Honest coverage.** Funnel metrics are checked only on final days. Flags on the newest final
  day, or below 20 subscriptions, are capped at low severity with a caveat. `coverage.skipped`
  counts the checks that couldn't run, so "nothing unusual" is distinguishable from "nothing checkable".
- **UI:** severity badges, filters, a per-anomaly chart against its baseline band, a description of
  the method, and **"Ask ADWISE about this"** / **"Investigate"** links that hand over the anomaly's figures.

### 7. Budget pacing

Each ad set's average daily spend over a recent window (7 days by default, max 14) divided by its
current daily budget. Outside the **±10% band** it's flagged `over` or `under`, otherwise
`on_pace`, or `paused`. The window is deliberately short because `daily_budget_usd` only holds the
*current* budget. It appears in the brief, in the agent, and at `GET /budgets/pacing`.

### 8. Releases

App releases parsed from the case's `build-logs/` at boot. They're shown in the brief, and used by
the agent and by investigations to line up performance changes with app versions.

### 9. ChatGPT connector (MCP)

The same six agent tools, served over **MCP (Streamable HTTP, stateless)** so ChatGPT can query the
ad data as a connector. Here ChatGPT is the model, so no ZenMux call is made. It's off unless
`MCP_SECRET` is set.

1. Set `MCP_SECRET` (`openssl rand -hex 32`) and expose the API on a public domain.
2. In ChatGPT, open **Settings → Apps & Connectors → Developer mode** and add a connector with the
   URL `https://<api-domain>/mcp/<MCP_SECRET>` and no auth.

### 10. Observability

`/observability` (signed-in only) answers: are agent runs succeeding, how long do they and their
model/tool calls take, what do they cost, what happened in one run, what failed, and is the API
process healthy. It has four tabs: **Overview**, **Agent runs**, **Logs & traces**, **Runtime**,
plus a run inspector at `/observability/runs/<runId or traceId>`.

Every number comes from real runtime events. Nothing is seeded, and anything not reported shows as
"Not reported" / "Unavailable", never 0.

#### What is recorded

| Data | Where | When |
| --- | --- | --- |
| **Runs**: one per agent question (`POST /agent/chat`) and per investigation (`POST /investigations`, when a model is configured) | `agent_runs` | Inserted as `running` at start, completed in a `finally` |
| **Spans**: one per model call, tool call and investigation stage | `agent_spans` | When each finishes |
| **Logs**: every warn/error/fatal line, plus info lines that name a `component` (e.g. "Agent run succeeded") | `application_logs` | From a pino `logMethod` hook, so every `app.log`/`req.log` call is covered |
| **Runtime**: memory, CPU, event-loop delay | In memory only (last ~10 min) | One sample every 10 s |

Telemetry is a separate SQLite file, `TELEMETRY_PATH` (default `apps/server/data/telemetry.db`),
opened with Node's built-in `node:sqlite`. The case database stays read-only and is never touched.
The schema is created by versioned migrations (`PRAGMA user_version`), so a second boot changes nothing.

**Never stored:** prompts, answers, model reasoning, tool results, SQL, API keys, cookies,
authorization headers, or env values. A tool span keeps its step-list label (e.g. "CAC by channel ·
last week"), its argument *names* and the result's size in bytes. Every stored string and object goes
through `apps/server/src/lib/redact.ts`, which handles secret-named keys at any depth, bearer tokens,
JWTs, `sk-…` keys, `?api_key=` and the MCP path secret. Content-like keys (`prompt`, `answer`, `rows`, …)
become `[OMITTED]`. Context is capped at 4 KB and messages at 500 characters.

#### Correlation

Each run has a `runId` (UUID), a W3C-style `traceId` and a root span id. Every span carries the run
and trace ids and the root as its parent, plus a `step` so tool calls line up with the model call that
requested them. Log lines about a run carry `runId`/`traceId`, and the run keeps the Fastify
`requestId`. The log explorer links a line to its run's trace; lines without a run show no link.
The inspector lists the run's own log lines.

#### How the numbers are calculated

- **Status.** `success` means the answer (or interpretation) was delivered. An HTTP 200 whose stream
  ends in an `error` event is a `failure`. `timeout` means the model ran past `MODEL_TIMEOUT_MS`.
  `cancelled` means the client went away. `interrupted` means the process stopped mid-run (detected at
  the next boot). A failed tool call the model recovers from doesn't fail the run; it's counted in
  `toolErrorCount`.
- **Success rate** = success ÷ (success + failure + timeout + interrupted). Cancelled runs don't count,
  and it is null with no finished runs.
- **Durations** use `performance.now()` (monotonic). Run duration runs from request to the last
  streamed event. Model time is the sum of the run's model calls. Averages and percentiles cover
  successful runs, and P95 (nearest rank) appears only from 20 runs.
- **Tokens** are ZenMux's `usage` per call (prompt, completion incl. reasoning, total, cached),
  summed over the calls that reported them. A run where only some calls reported is marked partial.
- **Retries** (429/5xx when opening a stream) are counted per call as `attempts − 1`. They bill
  nothing, so they never double-count tokens or cost.
- **Comparison** with the previous window appears only when that window has 5+ finished runs.
- **Windows** are real wall-clock time ending now (1h / 24h / 7d / 30d). This differs from the case
  data's fixed "today". Chart buckets are 5 min / 1 h / 6 h / 1 day, UTC-aligned. Empty buckets show
  0 runs and no averages; nothing is interpolated.

#### Cost

Cost is labelled an estimate everywhere and is in USD.

1. **Provider-reported first.** ZenMux returns each call's billed cost in the stream's `usage.cost`.
   This was verified against a real call on 2026-10-29, and that figure is used as is.
2. **Configured prices as fallback**, only when a call reports tokens but no cost:
   `apps/server/src/constants/pricing.constant.ts`. The source is `https://zenmux.ai/api/v1/models`,
   read 2026-10-29, and the file records how each value was chosen. Edit that one file when prices change.
3. **Otherwise unknown.** A run's cost is set only when every model call has one. Totals sum the
   priced runs and say how many were left out.

#### Runtime (live, this process only)

`process.memoryUsage()` gives heap used/total, RSS, external and array buffers, in bytes in the API
and MiB in the UI. The UI also shows uptime, Node version, and a cgroup memory limit when
`process.constrainedMemory()` reports one. CPU is `process.cpuUsage()` over the measured 10 s
interval, as a % of one core, and stays empty until the first interval has passed. Event-loop delay
comes from `monitorEventLoopDelay` with its 20 ms sampling period subtracted. Dependency checks run
`SELECT 1` on the case DB and on the telemetry store, at most every 5 s, recording the last success.

**Not available:** host, container, disk and network metrics. The process can't observe them, so they
aren't shown or estimated. With several API instances, each reports only itself. The dashboard's own
Next.js process isn't covered.

#### API

All routes are `GET`, need the JWT, are documented at `/docs`, and are rate-limited like the rest:

| Route | Returns |
| --- | --- |
| `/observability/summary?range&kind` | KPIs, previous-window comparison, per-tool and per-model call stats |
| `/observability/timeseries?range&kind` | Buckets: outcomes, durations, model time, tokens, cost |
| `/observability/runs?range&kind&status&model&tool&minDurationMs&maxDurationMs&q&sort&order&limit&offset` | Paged runs (max 100 per page) |
| `/observability/runs/:id` | A run (by run id or trace id) with its spans, logs and why it may be partial |
| `/observability/logs?range&level&errorsOnly&component&correlationId&before&limit` | Keyset-paged logs (max 200 per page) |
| `/observability/runtime` | This process's runtime snapshot and checks |

Inputs are validated by TypeBox. Id searches only accept `[A-Za-z0-9-]`, so they can't carry SQL
wildcards. All SQL uses bound parameters, and sort columns come from a fixed list. Aggregates read
at most 20,000 rows per window and report `truncated` past that. The app has one shared team
account, so every signed-in user sees all telemetry. There is no per-user scoping because the app has
no per-user data model.

#### Reliability trade-offs

- **Best-effort writes.** A failed telemetry write is caught, logged once (then every 100th) and
  counted on the Runtime tab. The agent's behaviour and its error events are unchanged. The cost of
  this choice is that a run can be missing or partial when the file can't be written, and the
  inspector says so. A failed run is never recorded as a success.
- **Writes are synchronous** prepared statements on a WAL database (well under a millisecond), so
  nothing is buffered in memory that a crash could lose.
- **Bounded growth.** Runs, spans and logs older than `TELEMETRY_RETENTION_DAYS` (default 30) are
  deleted at boot and hourly. Logs are also capped at 50,000 rows and 600 writes a minute (overflow
  is counted and noted). Observability routes log their own requests only at warn, so reading the
  page doesn't generate its own logs.
- **Persistence.** In Docker the file lives in `apps/server/data`, on the same named volume as the
  rules. It is a local file, so it is per instance and not shared across replicas. Several instances
  would need a shared store (e.g. Postgres) or an OpenTelemetry collector.

#### Try it

1. `pnpm dev`, sign in, ask ADWISE a question, then open **Observability → Agent runs** and click the run.
2. To see a failure, temporarily set an invalid `ZENMUX_API_KEY` and ask again. The run shows
   `MODEL_ERROR` with the provider's message (the key is never stored), and the warning appears under
   **Logs & traces**.
3. Tests: `pnpm --filter server test` (`test/observability.test.ts` covers success/failure/timeout/cancel
   runs, tool spans, token and cost math, redaction, paging and limits, auth, telemetry write failures,
   interrupted runs and runtime units).

#### Limitations and next steps

- Spans are flat under the run (model call → tools by `step`), not a nested tree. Streaming
  time-to-first-token isn't recorded yet.
- MCP (ChatGPT) tool calls aren't recorded: ChatGPT is the model there, so there is no run to attach them to.
- No alerting. A natural next step is a webhook when the failure rate or P95 crosses a threshold.
- Runtime history resets with the process. Persisting samples would allow day-scale memory trends.
- The ids are OpenTelemetry-shaped, so exporting spans over OTLP later wouldn't change the model.

## Domain rules: metric definitions

The definitions come from the case's `glossary.md` and `team-notes.md`. Where they conflict with
intuition, the team's definitions win. The dashboard, the API and the agent all use the same
definitions (`apps/server/src/constants/metrics.constant.ts`, also served at `GET /metrics/catalog`).

| Metric | Formula | Final after |
| --- | --- | --- |
| Spend, impressions, clicks, installs, trials | raw daily totals | same day |
| Subscriptions | raw | 4 days |
| Trial conversions | raw | 5 days |
| D7 revenue | raw | 7 days |
| CPI | spend ÷ installs | same day |
| Cost per trial | spend ÷ trials | same day |
| **CAC** | **spend ÷ subscriptions** | 4 days |
| Trial → sub | trial conversions ÷ trials | 5 days |
| D7 ROAS | D7 revenue ÷ spend | 7 days |
| CTR | clicks ÷ impressions | same day |

- **Maturity.** A ratio is final only when both its parts are, so CAC for days less than 4 days
  old isn't final. Non-final figures are shown and labelled, never silently dropped.
- **Ratios are recomputed from sums,** never averaged across rows.
- **Compare channels within each country first,** then give the blended number.
- **No firm conclusions under 20 subscriptions** (team note 6).
- Money is USD with two decimals, and percentages have one decimal.

## Security

- **No secrets in the repo or the browser.** Only `.env.example` files are committed. The dashboard
  reads `API_URL` and the JWT in server-only code, and there are no `NEXT_PUBLIC_*` secrets.
- **Read-only data.** The case DB is opened read-only. There are no Prisma migrations,
  `db push` or `db pull` (the Prisma config has no URL, so they'd fail anyway). The server writes
  only its own files in `apps/server/data/`.
- **Validated input.** Every request body, query and param is validated by TypeBox
  (`400 VALIDATION_ERROR`). SQL uses bound parameters and whitelisted sort columns.
- **Auth:** constant-time credential checks, 12 h JWTs, httpOnly cookies, rate-limited logins,
  helmet security headers, CORS limited to `CORS_ORIGIN`, and a strict CSP on the docs login page.
- **Rate limits:** global plus per-route limits on the expensive endpoints (see the API reference).
- **Redaction.** Logs and telemetry never store prompts, answers, tool results, keys, cookies or
  auth headers (see Observability).
- **Startup validation.** Weak or missing secrets stop the server from booting.
- The repo is private, and the case material must never be published.

## Testing and quality gates

```bash
pnpm typecheck   # tsc in both apps (strict, no any)
pnpm lint        # ESLint in both apps
pnpm test        # server tests: node:test + Fastify app.inject, against the real case DB
pnpm build       # production build of both apps
```

**Done means all four pass.** The server suite (`apps/server/test/`, 186 tests) covers:

- `app`, `routes`: auth, the envelope, validation and rate limits on every route;
- `metrics`, `brief`, `anomalies`, `rules`, `pins`, `insights`: domain logic and HTTP behaviour;
- `agent`, `investigation`, `mcp`: the agent loop with a scripted fake model, guardrails, and MCP;
- `observability`: runs, spans, tokens and cost math, redaction, paging, auth, write failures and
  runtime units.

Tests need `DB_PATH` and `CASE_DIR` in `apps/server/.env`. Each test app gets its own temporary
telemetry file. No test calls a real model.

## Deployment (Docker / Dokploy)

`docker-compose.yml` defines two services for a Dokploy "Docker Compose" app:

| Service | Image | Port | Notes |
| --- | --- | --- | --- |
| `server` | `apps/server/Dockerfile` (Node 26 slim, non-root `node` user) | 4001 (internal) | Health-checked on `/health`. Mounts the case folder read-only at `/case`, and a named volume at `apps/server/data` (rules, pins, insights, telemetry). |
| `dashboard` | `apps/dashboard/Dockerfile` (`next start`) | 4000 | Attach the public domain here. Reaches the API at `http://server:4001`. Starts once the server is healthy. |

Steps:

1. Copy the case folder to the host (e.g. `scp`) and set `CASE_HOST_DIR` to its path.
2. In Dokploy's **Environment** tab set `CORS_ORIGIN` (the dashboard URL), `JWT_SECRET`,
   `COOKIE_SECRET`, `APP_USER`, `APP_PASSWORD`, `DOCS_PASSWORD`, and optionally `ZENMUX_API_KEY`,
   `AGENT_MODEL`, `DOCS_ENABLED=true` and `MCP_SECRET`.
3. Attach the domain to `dashboard` (port 4000). Give `server` (port 4001) a domain only if you
   want public `/docs` or the ChatGPT connector; otherwise the API stays internal.
4. Deploy. Compose refuses to start if a required variable is missing (`${VAR:?}`).

The `data` volume survives redeploys. It's single-instance storage (JSON files and SQLite), so run
one `server` replica.

## Project structure

```
apps/
  dashboard/                Next.js 16 (App Router, cacheComponents)
    src/app/                routes: / (overview), /login, /anomalies, /investigate, /insights,
                            /rules, /observability (+ /runs/[id]), /export (file route), /agent/* proxies
    src/components/         feature components (dashboard, agent, anomalies, investigation,
                            insights, pins, rules, observability) + ui/ (shadcn)
    src/lib/api.ts          server-only API client: the one place that calls the API
    src/proxy.ts            session gate: redirects to /login without a session cookie
  server/                   Fastify 5 + TypeBox
    src/routes → controllers → services → database/repositories
    src/schemas/            TypeBox schemas (validation + OpenAPI)
    src/constants/          metric definitions, thresholds, models, pricing, limits
    src/plugins/            security, auth, database, telemetry, services, swagger, docs-auth
    src/clients/            zenmux.client.ts (OpenAI-compatible SSE + retries)
    prisma/schema.prisma    hand-written models of the case tables (read-only)
    test/                   node:test suites
docker-compose.yml          Dokploy deployment
```

App-specific engineering rules: `AGENTS.md` (root), `apps/server/AGENTS.md`, `apps/dashboard/AGENTS.md`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `pnpm install` fails on the engine check | Run `nvm use` (Node 26.12.1). |
| Server exits at boot with an env error | A required variable is missing or weak (e.g. `JWT_SECRET` < 32 chars, password < 8). The message names it. |
| `SQLITE_CANTOPEN` / data errors | `DB_PATH` must point at the case's `livensa.db` (absolute path). |
| Agent says it isn't configured | Set `ZENMUX_API_KEY` in `apps/server/.env` and restart. |
| Agent answer ends with `MODEL_ERROR` (403/401) | The ZenMux key is invalid or lacks access to the model. The run appears under Observability with the provider's message. |
| `/docs` redirects to `/docs/login` | Expected: sign in with `DOCS_USER`/`DOCS_PASSWORD`. In Docker, set `DOCS_ENABLED=true`. |
| Swagger "Try it out" returns 401 | The docs login doesn't authorize the API. Get a token from `POST /auth/login` and click **Authorize**. |
| `429 RATE_LIMITED` | Wait a minute (see the limits above). |
| Dashboard 500 on a newly added route during `pnpm dev` | Restart `pnpm dev`. A long-running Next dev server sometimes misses new route handlers. |
| Observability shows no logs | Only warn+ and component-tagged lines are stored, and `LOG_LEVEL=silent` stores nothing. |
