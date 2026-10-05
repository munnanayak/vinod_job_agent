# Job agent coverage audit — 2026-09-30

> **Status update, later on 2026-09-30.** The table below records the gaps found before the follow-up work and is kept for history. Since then the following were implemented and exercised in one live run (1,003 postings scanned, 60 saved, 280 queued): worldwide location scope, Adzuna across 19 markets with pagination and request budgets, searches driven by profile target roles, the optional SerpApi Google Jobs adapter, a persisted overflow queue, the standalone worker and `pnpm run doctor`. With `DISCOVERY_LOCATION_SCOPE=worldwide`, approved jobs outside the profile locations can also be prepared and published. Still true: no CAPTCHA handling, LinkedIn is read only through Gmail alerts, email auto-send stays disabled, and form submission needs the browser extension.

The current implementation is a local discovery and reviewed-application assistant. It does not yet satisfy worldwide, profile-driven, unattended application requirements.

| Requirement               | Verified implementation                                                                                               | Gap                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple markets          | Greenhouse, Lever, Ashby, Hacker News, Himalayas, RemoteOK, Remotive and Adzuna adapters in `apps/api/src/sources.ts` | Seeded/discovered boards are finite; no all-company coverage guarantee                                                                         |
| Worldwide Adzuna          | Three fixed queries against `/jobs/in/search/1`                                                                       | India only, first page only, fixed roles, INR hardcoded                                                                                        |
| Google job search         | Google OAuth, Gmail and Sheets in `apps/api/src/google.ts`                                                            | No Google Search or Google Jobs discovery adapter                                                                                              |
| LinkedIn email alerts     | Reads two LinkedIn job-alert sender addresses through Gmail; parses links and attempts company-board resolution       | Requires connected Gmail with read scope and existing alerts; capped at 200 messages per call; no direct LinkedIn application automation       |
| Profile matching          | Skills overlap, excluded roles, location preferences and production ML gap scoring                                    | `targetRoles` is stored but unused by API discovery; title filter only accepts full-stack and AI engineering; senior roles are always excluded |
| International eligibility | Location matching in `workflow.ts`                                                                                    | Remote matching assumes India/APAC/Asia; does not establish visa, work authorization or relocation eligibility                                 |
| Market preservation       | Deduplication by URL, source ID and company/title                                                                     | Company/title deduplication ignores location and can suppress distinct international vacancies                                                 |
| Automatic discovery       | API timer checks every ten minutes; configurable run interval                                                         | API and machine must stay running; `apps/worker` is a placeholder, no independent persistent worker                                            |
| Email applications        | Sheet approval, preview and publish, with duplicate-send protection                                                   | `autopilot().autoSend` is hardcoded false; `AUTO_SEND=true` cannot enable unattended sending                                                   |
| Form applications         | Browser extension fills supported Greenhouse/Lever/Ashby forms; optional countdown and submit click                   | Requires browser, approved batch and suitable forms; missing answers and challenges still require user intervention                            |

Discovery defaults to retaining 60 new candidates per run and scans at most 80 due company boards. Candidates are prioritized by startup/hiring-post flags before truncation, rather than by profile match score or country/source coverage. Fetched candidates beyond the limit are not queued for later processing.

## Validation

- `pnpm build` passed (nonfatal third-party bundler annotation warnings).
- `pnpm test`: 29 passed, 1 database integration test skipped, 0 failed.
- Required Adzuna, Google, database, token-encryption and Fuelix environment entries are nonempty. Values were not printed. Presence does not prove validity or active OAuth authorization.
- No live provider search, email send or application submission was performed. Provider availability, saved profile accuracy, OAuth grant validity and browser submission behavior remain unverified end to end.

## Implementation priorities

1. Make title selection and search queries derive from profile target roles; explicitly configure seniority and target markets.
2. Add configurable supported Adzuna markets, pagination, currency handling and per-market error/rate-limit handling. Check provider documentation before implementation.
3. Preserve separate country/location vacancies during deduplication and persist overflow candidates; allocate discovery fairly across sources and markets.
4. Add an explicitly configured search provider for Google-origin discovery, with source attribution and links to employer postings.
5. Add a persistent worker and visible source health, last-run status and credential/scope checks.
6. Define separate application modes for reviewed email publishing and browser form submission; do not advertise universal unattended applications.

The README contains historical milestone statements that contradict later implemented features, including claims that discovery/email are absent and that autopilot auto-sends. Use this audit and the source code for the current capability boundary.
