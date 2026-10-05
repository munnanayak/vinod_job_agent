# Architecture and implementation status

Implemented: pnpm workspace, React/Vite UI, NestJS REST API, PostgreSQL/Prisma, structured profile create/read/update, validation, dashboard and health endpoint.

The browser uses same-origin `/api` requests through the Vite development proxy. The API reads the root `.env`, listens on loopback and stores one candidate under a unique local owner key. Database failures are surfaced rather than replaced with demo state. Future multi-user deployment requires authentication and owner-scoped access.

Phases: (1) profile foundation; (2) job storage and ingestion; (3) matching and discovery dashboard; (4) truthful resume and answer preparation; (5) Gmail drafts and monitoring; (6) permitted ATS submission and tracking; (7) BullMQ schedules; (8) explicitly configured automatic actions. Human review should be the default from the first application workflow, not delayed until phase eight.

Redis, BullMQ and external credentials are unnecessary for this milestone. Reserved directories are documented placeholders, not working agents.

Toolchain references: https://docs.nestjs.com/first-steps, https://vite.dev/guide/, https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference.
