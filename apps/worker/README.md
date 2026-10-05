# Background worker

The working scheduler entry point is `apps/api/src/worker.ts`, sharing the API's discovery service and database models.

After `pnpm db:generate`, `pnpm db:migrate` and `pnpm build`, run `pnpm worker` from the repository root. It runs scheduled discovery according to `AUTO_RUN_HOURS`, processes persisted backlog, exports Sheets and checks replies. It never submits applications. Provider cursors, quotas and backlog survive process restarts.

The API's embedded scheduler can coexist with this worker; a PostgreSQL advisory lock serializes workflow steps. Set `SCHEDULER_ENABLED=false` to disable only the API timer. Use an OS process manager for reboot/crash recovery and keep the host awake. The API is still needed for the dashboard, OAuth connection and form assistant.

For one scheduled check, from `apps/api` run `node dist/worker.js --once`. This may contact providers and send a summary email when a run is due; use `pnpm run doctor` for read-only diagnostics instead.
