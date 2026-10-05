# Data design

CandidateProfile has a unique local owner key and generated UUID. Skills, target roles, excluded roles and locations are PostgreSQL arrays. Education, experience and projects are validated JSON records. Salary currency is explicit; unset numeric preferences remain null. Creation and update timestamps are stored server-side. Atomic upsert prevents multiple local profiles.

Nested history is stored as JSONB for this first aggregate; normalize into related tables when independent querying/versioning is needed. Future users and candidate ownership replace the local owner key when authentication is introduced.

Next tables: jobs, job sources, job matches, resumes, applications, agent runs and agent tasks. A unique (source, externalId) prevents repeated ingestion from one source. Cross-source deduplication needs a canonical ATS identifier or normalized application URL plus carefully reviewed company/title/location fingerprinting. It is not solved by the source identifier constraint alone.

Keep matches separate from source jobs. Record score dimensions, evidence, missing data and decision. Keep submission records idempotent. Resume versions reference candidate facts; do not overwrite the source profile with generated claims.
