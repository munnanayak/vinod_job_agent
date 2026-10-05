import test from "node:test";
import assert from "node:assert/strict";
import {
  FormAssistant,
  FormSessions,
  formTarget,
  formJobOpen,
} from "../apps/api/dist/forms.js";
import { JobWorkflow, autopilot, rowFor } from "../apps/api/dist/workflow.js";
import { HEADERS } from "../apps/api/dist/workflow-rules.js";
import {
  isPublicAddress,
  publicHttpsUrl,
} from "../apps/api/dist/public-page.js";
import { GoogleIntegration } from "../apps/api/dist/google.js";

const url = "https://jobs.lever.co/acme/12345678-aaaa-bbbb-cccc-123456789012";
test("Greenhouse preparations use the embedded form to avoid company-site redirects", () => {
  assert.equal(
    formTarget("https://job-boards.greenhouse.io/databricks/jobs/8384595002")
      .url,
    "https://job-boards.greenhouse.io/embed/job_app?for=databricks&token=8384595002",
  );
});
test("closed redirects consume only the original board's preparation once", () => {
  const sessions = new FormSessions();
  const issued = sessions.issue("job", "hash", "greenhouse:gitlab:123", 1000);
  assert.throws(
    () =>
      sessions.consumeClosed(
        issued.code,
        "https://job-boards.greenhouse.io/embed/job_board?for=other&error=true",
        1001,
      ),
    /Not this job/,
  );
  assert.throws(
    () =>
      sessions.consumeClosed(
        issued.code,
        "https://job-boards.greenhouse.io/embed/job_board?for=gitlab",
        1001,
      ),
    /Not this job/,
  );
  assert.equal(
    sessions.consumeClosed(
      issued.code,
      "https://job-boards.greenhouse.io/embed/job_board?for=gitlab&error=true",
      1001,
    ).jobId,
    "job",
  );
  assert.throws(
    () =>
      sessions.consumeClosed(
        issued.code,
        "https://job-boards.greenhouse.io/embed/job_board?for=gitlab&error=true",
        1002,
      ),
    /already used/,
  );
});
test("application queue moves past closed jobs to the next open job", async () => {
  const service = new FormAssistant({
    approvedFormJobIds: async () => ["closed", "open"],
  });
  service.prepare = async (id) => ({
    jobId: id,
    url: `https://job-boards.greenhouse.io/acme/jobs/${id === "closed" ? 1 : 2}`,
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).endsWith("/1")
      ? new Response("{}", { status: 404 })
      : new Response(JSON.stringify({ id: 2 }), { status: 200 });
  try {
    const batch = await service.batch(1);
    assert.deepEqual(
      batch.ready.map((job) => job.jobId),
      ["open"],
    );
    assert.deepEqual(batch.skipped, [
      { jobId: "closed", reason: "This job is no longer open." },
    ]);
    assert.equal(batch.remaining, 0);
    assert.equal((await service.batch(1)).skipped.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("closed form jobs are skipped without treating provider failures as closure", async () => {
  const request = (status, data) => async () =>
    new Response(JSON.stringify(data), { status });
  assert.equal(
    await formJobOpen("greenhouse:gitlab:123", request(404, {})),
    false,
  );
  assert.equal(
    await formJobOpen("greenhouse:gitlab:123", request(200, { id: 123 })),
    true,
  );
  assert.equal(
    await formJobOpen("jobs.lever.co:acme:abc", request(410, {})),
    false,
  );
  assert.equal(
    await formJobOpen(
      "jobs.ashbyhq.com:acme:abc",
      request(200, { jobs: [{ id: "other" }] }),
    ),
    false,
  );
  assert.equal(
    await formJobOpen(
      "jobs.ashbyhq.com:acme:abc",
      request(200, { jobs: [{ id: "abc", isListed: true }] }),
    ),
    true,
  );
  await assert.rejects(
    formJobOpen("greenhouse:gitlab:123", request(429, {})),
    /retry later/,
  );
  await assert.rejects(
    formJobOpen("greenhouse:gitlab:123", request(200, {})),
    /retry later/,
  );
  await assert.rejects(
    formJobOpen("jobs.ashbyhq.com:acme:abc", request(200, {})),
    /retry later/,
  );
});
test("form URLs bind to an exact supported job and reject lookalikes", () => {
  assert.equal(
    formTarget(url).identity,
    formTarget(url + "/apply?utm_source=site").identity,
  );
  assert.notEqual(
    formTarget(url).identity,
    formTarget(url.replace("12345678-", "87654321-")).identity,
  );
  assert.equal(
    formTarget("https://boards.greenhouse.io/acme/jobs/123").identity,
    formTarget("https://job-boards.greenhouse.io/acme/jobs/123").identity,
  );
  assert.equal(
    formTarget(
      "https://job-boards.greenhouse.io/embed/job_app?for=Acme&token=123",
    ).identity,
    formTarget("https://job-boards.greenhouse.io/acme/jobs/123").identity,
  );
  assert.equal(
    formTarget(
      "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=12x",
    ),
    null,
  );
  for (const u of [
    "http://jobs.lever.co/acme/12345678",
    "https://jobs.lever.co.evil.test/acme/12345678",
    "https://linkedin.com.evil.test/jobs/view/1",
    "https://jobs.lever.co/acme/12345678/settings",
    "https://user@jobs.lever.co/acme/12345678",
    "https://jobs.lever.co:444/acme/12345678",
  ])
    assert.equal(formTarget(u), null, u);
});
test("form codes expire, cannot cross jobs, and are consumed once", () => {
  const sessions = new FormSessions();
  const issued = sessions.issue("job", "hash", formTarget(url).identity, 1000);
  assert.throws(
    () => sessions.consume(issued.code, url.replace("acme", "other"), 1001),
    /Wrong application/,
  );
  assert.equal(sessions.consume(issued.code, url, 1002).jobId, "job");
  assert.throws(() => sessions.consume(issued.code, url, 1003), /already used/);
  const expired = sessions.issue("job", "hash", formTarget(url).identity, 1000);
  assert.throws(() => sessions.consume(expired.code, url, 602000), /expired/);
});
test("claim rechecks approval and profile before returning any CV bytes", async () => {
  const data = {
    job: { id: "job", url, title: "Full Stack Engineer", company: "Acme" },
    profile: {
      name: "Candidate",
      email: "me@example.com",
      phone: "",
      portfolioUrl: "",
      githubUrl: "",
    },
    resume: {
      sha256: "abc",
      fileName: "cv.pdf",
      sizeBytes: 8,
      content: Buffer.from("%PDF-1.4"),
    },
  };
  let rejected = false;
  const service = new FormAssistant({
    reviewedFormJob: async () => {
      if (rejected) throw Error("Approval revoked");
      return data;
    },
  });
  const preparation = await service.prepare("job");
  assert.equal(preparation.resume.base64, undefined);
  rejected = true;
  await assert.rejects(
    () => service.claim(preparation.code, url),
    /Approval revoked/,
  );
  rejected = false;
  await assert.rejects(
    () => service.claim(preparation.code, url),
    /already used/,
  );
  const next = await service.prepare("job");
  data.profile.email = "changed@example.com";
  await assert.rejects(() => service.claim(next.code, url), /changed/);
  const valid = await service.prepare("job");
  const packet = await service.claim(valid.code, url);
  assert.equal(
    Buffer.from(packet.resume.base64, "base64").toString(),
    "%PDF-1.4",
  );
});
test("AUTO_SEND=true cannot bypass approval + Publish", () => {
  const old = process.env.AUTO_SEND;
  process.env.AUTO_SEND = "true";
  try {
    assert.equal(autopilot().autoSend, false);
  } finally {
    if (old === undefined) delete process.env.AUTO_SEND;
    else process.env.AUTO_SEND = old;
  }
});
test("company page URLs and address checks reject private and reserved networks", () => {
  for (const a of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])
    assert.equal(isPublicAddress(a), false, a);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  for (const u of [
    "http://example.com",
    "https://127.0.0.1",
    "https://localhost",
    "https://host.internal",
    "https://user:pass@example.com",
    "https://example.com:8443",
  ])
    assert.throws(() => publicHttpsUrl(u));
});
test("OAuth callback requires the initiating browser cookie", async () => {
  const google = new GoogleIntegration({});
  await assert.rejects(
    () => google.complete("code", "attacker-state"),
    /browser/,
  );
  await assert.rejects(
    () => google.complete("code", "attacker-state", "different"),
    /browser/,
  );
});

function fakeWorkflow(count = 1) {
  const profile = {
    id: "profile",
    name: "Candidate",
    email: "me@example.com",
    phone: "",
    portfolioUrl: "",
    githubUrl: "",
    summary: "Developer",
    currentTitle: "Full-Stack Developer",
    yearsOfExperience: 2,
    skills: ["React"],
    locations: [],
    remotePreference: null,
    excludedRoles: [],
  };
  const resume = {
    fileName: "cv.pdf",
    sha256: "hash",
    sizeBytes: 8,
    content: Buffer.from("%PDF-1.4"),
  };
  const jobs = Array.from({ length: count }, (_, i) => ({
    id: `job${i}`,
    company: "Acme",
    title: "Full Stack Engineer",
    url: url.replace("12345678-", `${12345678 + i}-`),
    description: "Send your resume to jobs@example.com",
    email: "jobs@example.com",
    emailSourceUrl: url,
    emailEvidence: "Send your resume to jobs@example.com",
    location: "Remote",
    salary: "Not disclosed",
    matchScore: 70,
    matchReason: "Matches React",
    matchedSkills: ["React"],
    missingSkills: [],
    source: "lever",
    board: "acme",
    externalId: String(i),
    review: "PENDING",
    discoveredAt: new Date("2026-09-26T00:00:00Z"),
    application: null,
  }));
  const rows = [
    HEADERS,
    ...jobs.map((j) => {
      const row = rowFor(j);
      row[1] = "APPROVED";
      row[10] = "YES";
      return row;
    }),
  ];
  const batches = new Map();
  let seq = 0;
  const sent = [];
  const db = {
    client: {
      $transaction: async (work) =>
        work({ $queryRaw: async () => [{ acquired: true }] }),
      candidateProfile: { findUnique: async () => profile },
      resume: {
        findUnique: async () => resume,
        findUniqueOrThrow: async () => resume,
      },
      jobOpening: {
        findMany: async () => jobs,
        findUnique: async ({ where }) => jobs.find((j) => j.id === where.id),
        update: async ({ where, data }) =>
          Object.assign(
            jobs.find((j) => j.id === where.id),
            data,
          ),
      },
      publishBatch: {
        create: async ({ data }) => {
          const b = { id: `batch${seq++}`, state: "PREVIEW", ...data };
          batches.set(b.id, b);
          return b;
        },
        findUnique: async ({ where }) => batches.get(where.id),
        update: async ({ where, data }) =>
          Object.assign(batches.get(where.id), data),
        updateMany: async ({ where, data }) => {
          const b = batches.get(where.id);
          if (b.state !== where.state) return { count: 0 };
          Object.assign(b, data);
          return { count: 1 };
        },
      },
      jobApplication: {
        create: async ({ data }) => {
          const j = jobs.find((j) => j.id === data.jobId);
          if (j.application)
            throw Object.assign(Error("duplicate"), { code: "P2002" });
          j.application = { ...data };
          return j.application;
        },
        update: async ({ where, data }) =>
          Object.assign(
            jobs.find((j) => j.id === where.jobId).application,
            data,
          ),
      },
    },
  };
  const google = {
    senderEmail: async () => profile.email,
    readSheet: async () => rows,
    writeRange: async () => {},
    sendMail: async (raw) => {
      sent.push(raw);
      return { id: "message", threadId: "thread" };
    },
  };
  return {
    workflow: new JobWorkflow(db, google),
    rows,
    jobs,
    google,
    sent,
    profile,
  };
}
test("deleted or rejected rows block prepared forms and publishing", async () => {
  const f = fakeWorkflow();
  const p = await f.workflow.preview();
  f.rows[1][1] = "REJECTED";
  await assert.rejects(
    () => f.workflow.publish(p.batchId, p.fingerprint),
    /changed/,
  );
  await assert.rejects(() => f.workflow.reviewedFormJob("job0"), /Approve/);
  f.rows.pop();
  await assert.rejects(() => f.workflow.reviewedFormJob("job0"), /Approve/);
  assert.equal(f.sent.length, 0);
});
test("uncertain Gmail result is blocked from retrying, even in a new batch", async () => {
  const f = fakeWorkflow();
  f.google.sendMail = async (raw) => {
    f.sent.push(raw);
    throw Error("timeout after acceptance");
  };
  const p = await f.workflow.preview();
  const result = await f.workflow.publish(p.batchId, p.fingerprint);
  assert.equal(result.results[0].status, "SEND_UNCERTAIN");
  assert.equal(f.jobs[0].application.status, "SEND_UNCERTAIN");
  await assert.rejects(
    () => f.workflow.publish(p.batchId, p.fingerprint),
    /already published/,
  );
  const next = await f.workflow.preview();
  assert.equal(next.items.length, 0);
  assert.equal(f.sent.length, 1);
});
test("revocation during a batch stops the next application", async () => {
  const f = fakeWorkflow(2);
  f.google.sendMail = async (raw) => {
    f.sent.push(raw);
    f.rows[2][1] = "REJECTED";
    return { id: "m", threadId: "t" };
  };
  const p = await f.workflow.preview();
  const result = await f.workflow.publish(p.batchId, p.fingerprint);
  assert.equal(f.sent.length, 1);
  assert.equal(result.results[1].status, "SKIPPED");
  assert.equal(f.jobs[1].application, null);
});
test("old senior roles and employers refusing automation are excluded from preview", async () => {
  const f = fakeWorkflow();
  f.jobs[0].title = "Staff Full Stack Engineer";
  f.rows[1][3] = f.jobs[0].title;
  assert.equal((await f.workflow.preview()).items.length, 0);
  f.jobs[0].title = "Full Stack Engineer";
  f.rows[1][3] = f.jobs[0].title;
  f.jobs[0].description = "No automated applications please.";
  assert.equal((await f.workflow.preview()).items.length, 0);
});

test("changing profile target roles invalidates approval for an old role", async () => {
  const f = fakeWorkflow();
  f.profile.targetRoles = ["Backend Developer"];
  assert.equal((await f.workflow.preview()).items.length, 0);
  await assert.rejects(
    () => f.workflow.reviewedFormJob("job0"),
    /does not match any target role/,
  );
  assert.equal(f.sent.length, 0);
});

test("unidentified sheet rows cannot authorize forms or break valid form approvals", async () => {
  const f = fakeWorkflow();
  f.rows.push(["", "APPROVED", "Unidentified company"]);
  assert.equal((await f.workflow.reviewedFormJob("job0")).job.id, "job0");
  await assert.rejects(() => f.workflow.preview(), /no Job ID/);
  f.rows.push([...f.rows[1]]);
  await assert.rejects(
    () => f.workflow.reviewedFormJob("job0"),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.match(error.message, /Duplicate Job ID/);
      return true;
    },
  );
});

test("approved aggregator jobs with supported URLs enter the form queue", async () => {
  const f = fakeWorkflow();
  f.jobs[0].source = "google-jobs";
  f.rows[1][19] = "google-jobs:acme";
  let query;
  f.workflow.db.client.jobOpening.findMany = async (input) => {
    query = input;
    return f.jobs;
  };
  f.workflow.db.client.jobApplication.findMany = async () => [];
  assert.deepEqual(await f.workflow.approvedFormJobIds(), ["job0"]);
  assert.equal(query.where.source, undefined);
  assert.equal(
    (await new FormAssistant(f.workflow).prepare("job0")).provider,
    "Lever",
  );
});

test("LinkedIn external Apply resolves a supported form while preserving original approval", async () => {
  const f = fakeWorkflow();
  f.jobs[0].source = "linkedin";
  f.jobs[0].url = "https://www.linkedin.com/jobs/view/12345/";
  f.rows[1][6] = f.jobs[0].url;
  f.rows[1][19] = "linkedin:acme";
  const service = new FormAssistant(f.workflow);
  const prepared = await service.prepare("job0");
  assert.equal(prepared.provider, "LinkedIn external apply");
  await assert.rejects(
    () =>
      service.resolve(
        prepared.code,
        f.jobs[0].url,
        "https://evil.test/application",
      ),
    /not a supported/,
  );
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 429 });
  try {
    await assert.rejects(
      () => service.resolve(prepared.code, f.jobs[0].url, url),
      /retry later/,
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ id: "12345678-aaaa-bbbb-cccc-123456789012" }),
      );
    const resolved = await service.resolve(prepared.code, f.jobs[0].url, url);
    const code = resolved.openUrl.split("#job-agent=")[1];
    assert.equal(
      (await service.claim(code, url)).identity,
      formTarget(url).identity,
    );
    assert.equal(f.jobs[0].url, "https://www.linkedin.com/jobs/view/12345/");
    assert.equal(f.sent.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("LinkedIn Apply cannot resolve a different job or revoked approval", async () => {
  const f = fakeWorkflow();
  f.jobs[0].source = "linkedin";
  f.jobs[0].url = "https://www.linkedin.com/jobs/view/12345/";
  f.rows[1][6] = f.jobs[0].url;
  f.rows[1][19] = "linkedin:acme";
  const service = new FormAssistant(f.workflow);
  const prepared = await service.prepare("job0");
  await assert.rejects(
    () =>
      service.resolve(
        prepared.code,
        "https://www.linkedin.com/jobs/view/999/",
        url,
      ),
    /Wrong application/,
  );
  f.rows[1][1] = "REJECTED";
  await assert.rejects(
    () => service.resolve(prepared.code, f.jobs[0].url, url),
    /Approve this job/,
  );
});

test("form queue follows sheet order and allows distinct jobs at the same company", async () => {
  const f = fakeWorkflow(3);
  f.rows.splice(1, 3, f.rows[3], f.rows[1], f.rows[2]);
  f.workflow.db.client.jobOpening.findMany = async () => [...f.jobs].reverse();
  f.workflow.db.client.jobApplication.findMany = async () => [
    { job: f.jobs[0] },
  ];
  assert.deepEqual(await f.workflow.approvedFormJobIds(), [
    "job2",
    "job0",
    "job1",
  ]);
  const original = globalThis.fetch;
  globalThis.fetch = async (requestUrl) =>
    new Response(
      JSON.stringify({ id: new URL(requestUrl).pathname.split("/").at(-1) }),
    );
  try {
    const result = await new FormAssistant(f.workflow).batch(3, true);
    assert.deepEqual(
      result.ready.map((job) => job.jobId),
      ["job2", "job0", "job1"],
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("failed preparations are skipped for the current loop and retried on another click", async () => {
  const service = new FormAssistant({
    approvedFormJobIds: async () => ["bad", "open"],
  });
  let attempts = 0;
  service.prepare = async (id) => {
    if (id === "bad") {
      attempts++;
      throw Error("Unavailable application");
    }
    return { jobId: id, url };
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ id: "12345678-aaaa-bbbb-cccc-123456789012" }),
    );
  try {
    assert.equal((await service.batch(1, true)).ready[0].jobId, "open");
    await service.batch(1);
    assert.equal(attempts, 1);
    await service.batch(1, true);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("approved unsupported links show application alternatives rather than no approvals", async () => {
  const f = fakeWorkflow();
  f.jobs[0].source = "hackernews";
  f.jobs[0].url = "https://news.ycombinator.com/item?id=123";
  f.rows[1][6] = f.jobs[0].url;
  f.rows[1][19] = "hackernews:acme";
  f.workflow.db.client.jobApplication.findMany = async () => [];
  const result = await new FormAssistant(f.workflow).batch(1, true);
  assert.equal(result.ready.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /Acme/);
  assert.match(result.skipped[0].reason, /Email your CV/);
  assert.equal(result.remaining, 0);
});

test("previous applications and edited approvals explain why they are excluded", async () => {
  const f = fakeWorkflow(2);
  f.jobs[0].application = { status: "SENT" };
  f.rows[2][3] = "Edited title";
  f.workflow.db.client.jobApplication.findMany = async () => [];
  const result = await new FormAssistant(f.workflow).batch(1, true);
  assert.equal(result.ready.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0].reason, /already recorded/);
  assert.match(result.skipped[1].reason, /Protected sheet columns/);
  assert.equal(result.remaining, 0);
});

test("a clicked application queue stops after ten submissions and needs another click", async () => {
  const submitted = [];
  const service = new FormAssistant({
    approvedFormJobIds: async () => [],
    markFormSubmitted: async (id) => submitted.push(id),
  });
  await service.batch(1, true);
  let prepared = 0;
  service.prepare = async (jobId) => ({
    jobId,
    url,
    openUrl: url + "#job-agent=code",
  });
  service.workflow.approvedFormJobIds = async () => [`next${prepared++}`];
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ id: "12345678-aaaa-bbbb-cccc-123456789012" }),
    );
  try {
    for (let i = 0; i < 10; i++) {
      service.reports.set(`token${i}`, {
        jobId: `job${i}`,
        company: "Acme",
        expires: Date.now() + 10000,
      });
      const result = await service.submitted(`token${i}`);
      if (i < 9) assert.ok(result.next);
      else assert.deepEqual(result, { ok: true, next: null, paused: 10 });
    }
    assert.equal(submitted.length, 10);
    assert.equal(prepared, 9);
    assert.equal(await service.next(), null);
    await service.batch(1, true);
    assert.ok(await service.next());
  } finally {
    globalThis.fetch = original;
  }
});

test("standalone form submissions do not start an application queue", async () => {
  const service = new FormAssistant({ markFormSubmitted: async () => {} });
  service.reports.set("token", {
    jobId: "job",
    company: "Acme",
    expires: Date.now() + 10000,
  });
  assert.deepEqual(await service.submitted("token"), { ok: true, next: null });
});

test("email previews cap each manually published batch at ten jobs", async () => {
  const f = fakeWorkflow(12);
  assert.equal((await f.workflow.preview()).items.length, 10);
  assert.equal(f.sent.length, 0);
});

test("restoring a blank sheet header preserves existing jobs and exports without duplicates", async () => {
  const f = fakeWorkflow(2);
  f.rows.pop();
  f.rows[0] = [];
  const existing = [...f.rows[1]];
  const writes = [];
  f.google.writeRange = async (range, values) => {
    if (range === "A1:T1") f.rows[0] = values[0];
  };
  f.google.writeRows = async (rows) => {
    for (const entry of rows) {
      writes.push(entry);
      f.rows[entry.row - 1] = entry.values;
    }
  };
  f.workflow.db.client.jobApplication.findMany = async () => [];
  f.workflow.db.client.jobOpening.updateMany = async () => ({ count: 1 });
  assert.equal((await f.workflow.export()).exported, 1);
  assert.equal(writes[0].row, 3);
  assert.deepEqual(f.rows[1], existing);
  assert.equal(f.rows[2][0], "job1");
  assert.equal((await f.workflow.export()).exported, 0);
  assert.equal(writes.length, 1);
  assert.equal(f.sent.length, 0);
});

test("closed listings release preparation slots before the next open job", async () => {
  const f = fakeWorkflow(105);
  const service = new FormAssistant(f.workflow);
  f.workflow.approvedFormJobIds = async () => f.jobs.map((j) => j.id);
  const original = globalThis.fetch;
  globalThis.fetch = async (requestUrl) => {
    const id = new URL(requestUrl).pathname.split("/").at(-1);
    return String(requestUrl).includes("12345782-")
      ? new Response(JSON.stringify({ id }))
      : new Response("{}", { status: 404 });
  };
  try {
    const batch = await service.batch(1, true);
    assert.equal(batch.skipped.length, 104);
    assert.equal(batch.ready[0].jobId, "job104");
    assert.equal(service.sessions.entries.size, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("startup recovers interrupted discovery only while owning the shared lock", async () => {
  const old = process.env.SCHEDULER_ENABLED;
  process.env.SCHEDULER_ENABLED = "false";
  const updates = [];
  let acquired = true;
  const workflow = new JobWorkflow(
    {
      client: {
        $transaction: async (work) =>
          work({ $queryRaw: async () => [{ acquired }] }),
        agentRun: {
          updateMany: async (query) => {
            updates.push(query);
            return { count: 2 };
          },
        },
      },
    },
    {},
  );
  try {
    await workflow.onModuleInit();
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].where, { finishedAt: null });
    assert.match(updates[0].data.error, /restart/);
    assert.ok(updates[0].data.finishedAt instanceof Date);
    acquired = false;
    await workflow.onModuleInit();
    assert.equal(updates.length, 1);
  } finally {
    if (old === undefined) delete process.env.SCHEDULER_ENABLED;
    else process.env.SCHEDULER_ENABLED = old;
  }
});
