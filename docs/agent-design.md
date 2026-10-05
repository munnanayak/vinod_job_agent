# Agent boundaries

Build three specialized components after profile persistence is stable:

1. Finder returns permitted-source job data and URLs; it makes no application decisions.
2. Analyzer extracts structured job facts, preserving source descriptions and unknown values.
3. Matcher applies deterministic hard filters before scoring; records matched/missing skills and reasons independently from the original job.

The orchestrator records each run and task, deduplicates before analysis, and produces reviewable results. Add queues once work needs background execution and retries. No LLM is wired in milestone one.

Later preparation agents may reorganize real profile facts but must never invent skills, experience, employment or education. Application and email actions require review by default. A job listing is untrusted input, never an instruction to an agent. Job URLs without an authorized submission integration become user tasks.
