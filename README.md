# Job Agent

A local React → NestJS → PostgreSQL job-search assistant with profile-driven discovery, international markets, Gmail job alerts, Google Sheets review, email publishing and a browser form assistant. Search coverage depends on configured providers and boards; it cannot enumerate every company or guarantee eligibility for every international job.

## Run

Use Node 24 LTS and pnpm 11.20.0. From this directory:

```sh
pnpm install
cp .env.example .env
# Set DATABASE_URL in .env to your PostgreSQL database, or:
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm build
pnpm dev
```

Open http://localhost:5173. API health: http://127.0.0.1:3000/api/health.

A workspace-local PostgreSQL cluster was also initialized during development at `.local/postgres`, on port **55432**. The existing ignored `.env` points to it; do not replace that file if using this cluster. Start/stop it with:

```sh
pg_ctl -D .local/postgres -l .local/postgres.log -o '-h 127.0.0.1 -p 55432 -k /tmp' start
pg_ctl -D .local/postgres stop
```

This development cluster uses local trust authentication. Use credentials and a properly secured PostgreSQL deployment outside local development. Docker is an alternative, not required when using the local cluster.

## Commands

- `pnpm build`: type-check all implemented packages and build the UI/API.
- `pnpm check`: build and run the profile, discovery, matching and application workflow tests.
- `pnpm test`: run tests against the last build.
- `pnpm run doctor`: check configuration presence and local API/database/source status without sending applications.
- `pnpm start`: run the built API, including its scheduler.
- `pnpm worker`: run the standalone scheduler without the API/UI; PostgreSQL must be available.
- `TEST_API_URL=http://127.0.0.1:3001/api pnpm test`: integration tests against an API connected to a **dedicated, empty test database**; creates a test profile.
- `pnpm db:generate`: regenerate Prisma client after schema changes.
- `pnpm db:migrate`: apply committed migrations.

Frontend edits reload automatically. For API source changes, run `pnpm --filter @job-agent/api build` in another terminal; the dev server watches compiled files. Shared package changes require rebuilding their packages.

## API

- `GET /api/health`: checks PostgreSQL connectivity.
- `GET /api/profile`: returns `{ profile }`, with `profile: null` for a new workspace.
- `PUT /api/profile`: validates and atomically creates/updates the local profile; returns `{ profile }`.

This is a local, single-user application. The API binds to loopback; authentication and per-user ownership must be added before deploying a shared service. CORS is not authentication.

## Structure

`apps/web` is the React dashboard, `apps/api` owns discovery, the standalone worker entry point and reviewed applications, `apps/form-assistant` is the Chrome extension, `packages/database` owns Prisma and migrations, and `packages/types` shares profile validation. `packages/ai`, `packages/integrations` and `packages/config` are reserved boundaries.

## Import a candidate profile and resume

Contact fields (email, phone, portfolio, GitHub), a professional summary and an optional remote preference are now supported. `null` remote preference means unknown; future matching must not treat it as an on-site requirement.

After applying migrations and building, import a validated profile JSON and its PDF from the repository root:

```sh
node apps/api/scripts/import-profile.mjs /path/to/profile.json /path/to/resume.pdf
```

The importer validates the profile and PDF, backs up any existing local candidate data under ignored `.local/backups`, and saves profile and PDF together in a transaction. The single current PDF is stored as bytes in PostgreSQL with its filename, size and SHA-256. The local UI provides a download link; `GET /api/resume` returns metadata and `GET /api/resume/file` returns the attachment. No resume is served as a public static asset. These loopback-only endpoints still require authentication before any shared deployment.

Email publishing attaches the stored PDF. Saving profile changes does not regenerate that PDF; import an updated resume when needed.

## Review-first job workflow (Jobs & publish page)

1. **Connect Google** (Gmail send, Gmail metadata for replies, Sheets). The refresh token is AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY`. The OAuth client's redirect URI must be `GOOGLE_REDIRECT_URI` (`http://localhost:3000/api/integrations/google/callback`). `GOOGLE_SHEETS_SPREADSHEET_ID` may be the ID or the sheet URL; the `GOOGLE_SHEETS_TAB_NAME` tab is created if missing.
2. **Discover** reads official Greenhouse/Lever boards from `JOB_BOARDS`, matches titles against your profile target roles, applies excluded roles and configured seniority, and scores skills. Worldwide discovery includes jobs outside your profile locations with a review note; application preparation and publishing still enforce your profile locations. AI roles that need production ML (PyTorch, MLOps, training…) you haven't listed are capped and flagged. Fuelix adds a short explanation; listings are treated as untrusted input. An email is only recorded when the listing explicitly says to send an application there, with the evidence text.
3. **Fill Google Sheet** appends new jobs with a Job ID. Set **Review** to `APPROVED`/`REJECTED`/`PENDING`; set **Email Use Confirmed** to `YES` to allow emailing. Delete rows you don't want. Edits to other columns exclude that row.
4. **Preview** rereads the sheet and shows every approved job: email (recipient, subject, body, attached CV) or manual action. It is valid for 15 minutes.
5. **Publish** rereads the sheet again and refuses if anything changed since preview. Each job is claimed in the database (unique per job) before sending, so it can never be submitted twice. Jobs without a confirmed email become **Manual action required** with an application link and CV download. Status is written back to the sheet.
6. **Check replies** reads sent Gmail threads and records recruiter replies as notifications and in the sheet's Last Reply column.

LinkedIn-only jobs remain manual applications. Reading LinkedIn alert emails does not browse or submit on LinkedIn.

## Worldwide discovery and scheduling

One run discovers jobs, processes saved backlog, exports to Sheets when connected, checks recruiter replies and emails you a summary when there is activity. It does **not** send job applications.

- **Profile roles:** searches use `targetRoles` from your saved profile, including roles outside full-stack/AI. Common engineer/developer, full-stack, frontend, backend and Node.js spellings are normalized. `JOB_SENIORITY=junior-mid` is the default; set `all` to include senior/management titles that match your targets. Matching is an explainable skill-overlap heuristic, not proof of qualification.
- **Locations:** `DISCOVERY_LOCATION_SCOPE=worldwide` includes relocation leads. `profile` restricts discovery to profile locations. Existing location checks remain in application preparation/publishing. Review relocation, work authorization, salary and job-specific requirements before approval; update profile preferences if appropriate.
- **Company boards:** Greenhouse, Lever and Ashby, with seeded boards plus `JOB_BOARDS`. Boards linked from postings are registered for later scans. Up to 80 due boards are scanned per run. Add known boards to extend employer coverage.
- **Aggregators:** HN employer hiring posts, Himalayas, RemoteOK and Remotive. HN/Himalayas queries now use profile roles. Each source retains its own scan interval and error status.
- **Adzuna:** `ADZUNA_COUNTRIES=all` configures 19 country markets; alternatively list codes such as `in,us,gb,ca,au,de,sg`. `ADZUNA_PAGES=2` and `ADZUNA_REQUESTS_PER_RUN=18` rotate country/role/page combinations across runs. Salaries use each market's currency. Queries remain on Adzuna; application links retain Adzuna redirects.
- **Google Jobs:** optional SerpApi adapter, configured with `SERPAPI_API_KEY`. This is separate from Gmail OAuth. `GOOGLE_JOBS_COUNTRIES` controls countries; the defaults include India, US, UK, Canada, Australia, Germany, Singapore and UAE. Four queries per scan rotate through roles/markets; only the first ten results per query are requested. The local default monthly request budget is 100; adjust it to your provider plan. Where available, supported ATS application links are preferred.
- **Backlog:** fetched postings are persisted before sources are marked scanned. Each run analyzes up to `DISCOVERY_LIMIT` postings, sharing capacity across source/board buckets and preferring higher skill scores within each bucket. Overflow persists in PostgreSQL for up to 30 days. At most 10,000 queued postings are examined per run. Duplicate checks include location so the same title in different markets is preserved.
- **Quotas:** provider cursors and request timestamps survive restarts. Adzuna calls are spaced at least 2.5 seconds apart, with local rolling caps of 250/day, 1,000/week and 2,500/31 days. Failed requests consume budget too. These counters only track this installation; sharing keys elsewhere may exhaust provider limits earlier. Defaults follow [Adzuna's published limits](https://developer.adzuna.com/docs/terms_of_service). Google Jobs integration follows the [SerpApi API documentation](https://serpapi.com/google-jobs-api).
- **Applications:** email requires approval, Preview and Publish. `AUTO_SEND` is a legacy setting and does not enable unreviewed email. Browser submission is described below; CAPTCHA and unknown required answers need you.

Run `pnpm db:generate`, `pnpm db:migrate`, then `pnpm check` after updating. Existing `.env` credentials are preserved. Add your SerpApi key to enable Google Jobs, connect Google in the dashboard for Gmail/Sheets, and confirm your saved profile roles and country.

The API checks every ten minutes whether `AUTO_RUN_HOURS` has elapsed, with the first check one minute after startup. Alternatively run `pnpm worker` on an always-on machine; it loads the same `.env` and database and checks immediately. `AUTO_RUN_HOURS=0` disables scheduled discovery. `SCHEDULER_ENABLED=false` disables only the API's embedded timer. A database advisory lock prevents API and worker workflow steps from overlapping, and the schedule is rechecked under the lock. Use an OS process manager to restart the worker after crashes/reboots; neither command can run while the machine is asleep. The worker does not expose the dashboard or OAuth callback, so run the API when using those features.

The dashboard shows queued jobs, configured provider markets and last scan/errors. `pnpm run doctor` provides a read-only diagnostic summary. Configuration presence does not validate credentials; real provider errors appear after a scan.

## Form Assistant (Chrome extension) and batch apply

Fills approved jobs' real Greenhouse, Lever and Ashby application forms, one after another in the same tab (**Start applying**). By default you review, solve any CAPTCHA and click Submit. With **Submit automatically** ticked on the dashboard, a form with no missing required answers is submitted after a 10-second countdown; forms with missing answers or a CAPTCHA challenge still wait for you. The job is marked applied when the site shows its confirmation, and the next approved job opens. Steps 3–5 below describe the older one-tab-per-job flow.

1. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → `apps/form-assistant` (after updates, click the reload icon on the extension).
2. In **My profile** set first name, last name, LinkedIn URL and current city (used by forms).
3. Approve jobs in the sheet. On **Jobs & publish → Apply to approved jobs** click **Prepare next 10**, then **Open all** (allow pop-ups for localhost once) or **Open & fill** per job. Each link carries a one-use code (10 minutes) that only this extension can redeem, only on that exact job page.
4. Each tab fills automatically: contact fields, CV attachment, answers known from your profile (notice period, experience, current city/company, LinkedIn) and Fuelix drafts for open questions from your real profile facts. Filled fields are outlined in yellow; a banner lists what still needs you. Salary/CTC, visa, legal, consent and demographic questions are never answered.
5. After submitting on the site, click **I submitted it** in the banner. The job is marked applied in the dashboard and sheet.

Greenhouse jobs listed on a company's own site open Greenhouse's copy of the same form (`/embed/job_app`). Himalayas, RemoteOK, Remotive, Hacker News and LinkedIn links are not supported; apply there manually.

## LinkedIn job alerts (via Gmail)

LinkedIn has no job-search API for individuals and forbids automated browsing, so the agent never visits LinkedIn. Instead each run reads the LinkedIn job-alert emails in your Gmail (sender must be a `linkedin.com` address; last 14 days on the first run, then incrementally), extracts title, company, location and job link, and applies the usual role/seniority/location filters. For each match it looks for the same role on the company's own Greenhouse, Lever or Ashby board: if found, that posting (full description, Form Assistant support) is saved; otherwise the LinkedIn job is saved as **LinkedIn (apply yourself)**.

Setup: in Google Cloud → Data Access add `https://www.googleapis.com/auth/gmail.readonly` (and remove `gmail.metadata`, which blocks reading message bodies), then in the dashboard **Disconnect** and **Connect Google** again. On LinkedIn, create daily job alerts for your target roles.
