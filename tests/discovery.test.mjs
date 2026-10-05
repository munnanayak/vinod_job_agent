import test from "node:test";
import assert from "node:assert/strict";
import { targetRole } from "../apps/api/dist/workflow-rules.js";
import { locationFits, JobWorkflow } from "../apps/api/dist/workflow.js";
import {
  postingIdentity,
  selectPostings,
} from "../apps/api/dist/discovery-selection.js";
import {
  discoveryConfig,
  reserveRequest,
} from "../apps/api/dist/discovery-config.js";
import { adzuna, googleJobs } from "../apps/api/dist/sources.js";

function env(t, values) {
  const before = { ...process.env };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  t.after(() => {
    for (const key of Object.keys(values)) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
}
function context(roles = ["Backend Developer"]) {
  return {
    profile: { targetRoles: roles },
    state: { cursor: 0, requests: [] },
    errors: [],
    saveState: async () => {},
  };
}
function mockFetch(t, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const posting = (overrides = {}) => ({
  source: "lever",
  board: "acme",
  externalId: "1",
  company: "Acme",
  title: "Backend Engineer",
  location: "London, United Kingdom",
  salary: "Not disclosed",
  description: "TypeScript",
  url: "https://jobs.lever.co/acme/one",
  links: [],
  website: "",
  hiringPost: false,
  startup: false,
  ...overrides,
});

test("profile targets replace fixed role filters with bounded title aliases", () => {
  assert.equal(targetRole("Backend Engineer II", ["Backend Developer"]), true);
  assert.equal(targetRole("NodeJS Engineer", ["Node.js Developer"]), true);
  assert.equal(
    targetRole("React Native Engineer", ["React Native Developer"]),
    true,
  );
  assert.equal(targetRole("Frontend Developer", ["Backend Developer"]), false);
  assert.equal(targetRole("AI Product Manager", ["AI Engineer"]), false);
  assert.equal(targetRole("Fullstack Engineer", ["Data Scientist"]), false);
});

test("location checks do not assume every profile lives in India", () => {
  const uk = {
    country: "United Kingdom",
    locations: ["London"],
    remotePreference: true,
  };
  assert.equal(locationFits(uk, "Remote, UK"), true);
  assert.equal(locationFits(uk, "Remote, India"), false);
  assert.equal(locationFits(uk, "Remote (worldwide)"), true);
  assert.equal(locationFits(uk, "Anywhere, United States"), false);
  assert.equal(
    locationFits({ ...uk, remotePreference: false }, "Remote, London"),
    false,
  );
  assert.equal(
    locationFits({ ...uk, locations: ["US"] }, "Austin, Australia"),
    false,
  );
});

test("country-specific vacancies remain distinct and sources share processing capacity", () => {
  const uk = posting();
  const us = posting({ location: "New York, United States" });
  assert.notEqual(postingIdentity(uk), postingIdentity(us));
  const weak = posting({ externalId: "weak" });
  const strong = posting({ externalId: "strong" });
  const anotherMarket = posting({ source: "adzuna", board: "us" });
  assert.deepEqual(
    selectPostings([weak, strong, anotherMarket], 2, (p) =>
      p === strong ? 90 : 10,
    ),
    [strong, anotherMarket],
  );
});

test("invalid country and request settings fail visibly", (t) => {
  env(t, { ADZUNA_COUNTRIES: "in,xx", ADZUNA_PAGES: "2" });
  assert.throws(() => discoveryConfig(), /unsupported country/);
  process.env.ADZUNA_COUNTRIES = "us,uk,us";
  assert.deepEqual(discoveryConfig().adzunaCountries, ["us", "gb"]);
  process.env.ADZUNA_PAGES = "-1";
  assert.throws(() => discoveryConfig(), /ADZUNA_PAGES/);
});

test("Adzuna rotates markets and pages, uses profile queries and local currencies", async (t) => {
  env(t, {
    ADZUNA_APP_ID: "test-id",
    ADZUNA_APP_KEY: "test-key",
    ADZUNA_COUNTRIES: "us,gb",
    ADZUNA_PAGES: "2",
    ADZUNA_REQUESTS_PER_RUN: "1",
  });
  const urls = [];
  mockFetch(t, async (url) => {
    urls.push(new URL(url));
    return json({
      results: [
        {
          id: "42",
          title: "Backend Engineer",
          company: { display_name: "Acme" },
          location: { display_name: "London" },
          salary_min: 40000,
          salary_max: 50000,
          redirect_url: "https://example.com/jobs/42",
          description: "TypeScript",
        },
      ],
    });
  });
  const c = context();
  let persisted;
  c.saveState = async (state) => {
    persisted = structuredClone(state);
  };
  const first = await adzuna(c);
  assert.match(first[0].salary, /^USD/);
  assert.match(first[0].location, /United States/);
  assert.equal(urls[0].searchParams.get("what"), "Backend Developer");
  const next = { ...context(), state: persisted };
  const second = await adzuna(next);
  assert.match(second[0].salary, /^GBP/);
  assert.match(urls[1].pathname, /gb\/search\/1$/);
  next.state.requests = [];
  await adzuna(next);
  assert.match(urls[2].pathname, /us\/search\/2$/);
});

test("a failing Adzuna market retains successful results and errors exclude secrets", async (t) => {
  env(t, {
    ADZUNA_APP_ID: "secret-id",
    ADZUNA_APP_KEY: "secret-key",
    ADZUNA_COUNTRIES: "us,gb",
    ADZUNA_PAGES: "1",
    ADZUNA_REQUESTS_PER_RUN: "2",
  });
  mockFetch(t, async (url) =>
    new URL(url).pathname.includes("/us/")
      ? json({}, 500)
      : json({
          results: [
            {
              id: "1",
              title: "Backend Engineer",
              redirect_url: "https://example.com/jobs/1",
            },
          ],
        }),
  );
  const c = context();
  const jobs = await adzuna(c);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].board, "gb");
  assert.match(c.errors[0], /adzuna:us:page1/);
  assert.doesNotMatch(c.errors.join(), /secret/);
});

test("persisted quotas stop requests before fetch, including weekly limits", async (t) => {
  env(t, {
    ADZUNA_APP_ID: "id",
    ADZUNA_APP_KEY: "key",
    ADZUNA_COUNTRIES: "us",
    GOOGLE_JOBS_MONTHLY_LIMIT: "2",
  });
  const c = context();
  const now = Date.now();
  c.state.requests = Array(1000).fill(now - 2 * 86400000);
  assert.equal(await reserveRequest(c, "adzuna", now), false);
  c.state.requests = [now - 10000, now - 5000];
  assert.equal(await reserveRequest(c, "google", now), false);
  mockFetch(t, () => {
    throw Error("fetch must not run");
  });
  c.state.requests = Array(250).fill(now - 5000);
  assert.deepEqual(await adzuna(c), []);
});

test("Google Jobs uses country and target title and prefers supported application links", async (t) => {
  env(t, {
    SERPAPI_API_KEY: "test-key",
    GOOGLE_JOBS_COUNTRIES: "gb,ae",
    GOOGLE_JOBS_REQUESTS_PER_RUN: "2",
  });
  const urls = [];
  mockFetch(t, async (url) => {
    urls.push(new URL(url));
    return json({
      jobs_results: [
        {
          job_id: "abc",
          title: "Backend Engineer",
          company_name: "Acme",
          location: "Anywhere",
          description: "TypeScript",
          apply_options: [
            { link: "javascript:alert(1)" },
            { link: "https://example.com/job" },
            { link: "https://jobs.lever.co/acme/123" },
          ],
        },
      ],
    });
  });
  const jobs = await googleJobs(context());
  assert.equal(jobs.length, 2);
  assert.equal(urls[0].searchParams.get("gl"), "uk");
  assert.match(
    urls[1].searchParams.get("q"),
    /Backend Developer junior 0-3 years experience in United Arab Emirates/,
  );
  assert.equal(jobs[0].url, "https://jobs.lever.co/acme/123");
  assert.equal(jobs[0].location, "Anywhere, United Kingdom");
  assert.equal(jobs[0].website, "");
});

function fakeDiscovery() {
  const queue = new Map(),
    jobs = [];
  const profile = {
    id: "profile",
    targetRoles: ["Backend Developer"],
    excludedRoles: [],
    skills: ["TypeScript"],
    country: "India",
    locations: ["Hyderabad"],
    remotePreference: true,
  };
  let postings = [
    posting(),
    posting({
      externalId: "2",
      url: "https://jobs.lever.co/acme/two",
      location: "New York, United States",
    }),
  ];
  const db = {
    client: {
      $transaction: async (fn) =>
        fn({ $queryRaw: async () => [{ acquired: true }] }),
      candidateProfile: { findUnique: async () => profile },
      discoveryPending: {
        createMany: async ({ data }) => {
          for (const row of data)
            if (!queue.has(row.id))
              queue.set(row.id, { ...row, createdAt: new Date() });
        },
        findMany: async () => [...queue.values()],
        count: async () => queue.size,
        deleteMany: async ({ where }) => {
          for (const [id, row] of queue)
            if (
              where.id === id ||
              where.id?.in?.includes(id) ||
              (where.createdAt && row.createdAt < where.createdAt.lt)
            )
              queue.delete(id);
        },
      },
      jobOpening: {
        findFirst: async ({ where }) =>
          jobs.find((j) =>
            where.OR.some((w) =>
              w.url
                ? w.url === j.url
                : w.source
                  ? w.source === j.source &&
                    w.board === j.board &&
                    w.externalId === j.externalId
                  : w.company.equals === j.company &&
                    w.title.equals === j.title &&
                    w.location.equals === j.location,
            ),
          ),
        create: async ({ data }) => {
          jobs.push(data);
          return data;
        },
      },
    },
  };
  const workflow = new JobWorkflow(db, {});
  workflow.collect = async () => {
    await workflow.enqueue(postings);
    postings = [];
    return { boardsScanned: 0, aggregatorsRun: [], newBoards: 0, errors: [] };
  };
  workflow.linkedInPostings = async () => ({
    postings: [],
    emails: 0,
    note: "",
  });
  return { workflow, jobs, queue, db };
}

test("worldwide overflow survives source cooldown and carries eligibility notes", async (t) => {
  env(t, {
    DISCOVERY_LOCATION_SCOPE: "worldwide",
    DISCOVERY_LIMIT: "1",
    FUELIX_API_KEY: "",
  });
  const f = fakeDiscovery();
  const first = await f.workflow.discover();
  assert.equal(first.added, 1);
  assert.equal(first.queued, 1);
  assert.match(f.jobs[0].matchReason, /Outside your profile locations/);
  const second = await f.workflow.discover();
  assert.equal(second.added, 1);
  assert.equal(second.queued, 0);
  assert.equal(f.jobs.length, 2);
});

test("profile-only discovery rejects international locations", async (t) => {
  env(t, { DISCOVERY_LOCATION_SCOPE: "profile" });
  const f = fakeDiscovery();
  assert.equal((await f.workflow.discover()).added, 0);
});

test("shared lock rejects a second process without running discovery", async () => {
  const f = fakeDiscovery();
  f.db.client.$transaction = async (fn) =>
    fn({ $queryRaw: async () => [{ acquired: false }] });
  await assert.rejects(() => f.workflow.discover(), /Another API or worker/);
  assert.equal(f.jobs.length, 0);
});
