import test from "node:test";
import assert from "node:assert/strict";
import {
  HEADERS,
  applicationEmail,
  approved,
  messageRaw,
  parseReviewRows,
  targetRole,
  unchanged,
} from "../apps/api/dist/workflow-rules.js";
import { assessMatch, locationFits } from "../apps/api/dist/workflow.js";

const profile = {
  skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "LangChain"],
  locations: [],
  remotePreference: null,
};

test("only full-stack and AI engineering titles are targeted", () => {
  for (const t of [
    "Full Stack Developer",
    "Senior Full-Stack Engineer",
    "AI Engineer",
    "GenAI Engineering Lead",
  ])
    assert.equal(targetRole(t), true, t);
  for (const t of [
    "Frontend Engineer",
    "AI Product Manager",
    "Data Scientist",
    "Full Stack Designer",
  ])
    assert.equal(targetRole(t), false, t);
});

test("application email needs an explicit instruction and skips accommodation addresses", () => {
  assert.equal(
    applicationEmail(
      "To apply, send your resume and cover letter to jobs@example.com today.",
    ).email,
    "jobs@example.com",
  );
  assert.equal(
    applicationEmail("Questions? Contact hello@example.com").email,
    "",
  );
  assert.equal(
    applicationEmail(
      "If you need an accommodation, email your application questions to accommodations@example.com",
    ).email,
    "",
  );
});

test("only APPROVED rows count and protected edits are detected", () => {
  const row = HEADERS.map((_, i) => `v${i}`);
  const values = [HEADERS, ["", "", ""], row];
  const map = parseReviewRows(values);
  assert.equal(map.size, 1);
  assert.equal(approved(map.get("v0")), false);
  assert.equal(approved(["id", " approved "]), true);
  assert.equal(approved(["id", "Pending"]), false);
  const edited = [...row];
  edited[1] = "APPROVED";
  edited[10] = "YES";
  edited[16] = "Sent";
  assert.equal(
    unchanged(edited, row),
    true,
    "review/confirmation/status are user or app columns",
  );
  edited[7] = "someone@else.com";
  assert.equal(unchanged(edited, row), false, "recipient email is protected");
});

test("sheet structure problems block publishing", () => {
  assert.throws(() => parseReviewRows([["Wrong"]]), /headers changed/);
  const row = HEADERS.map(() => "x");
  assert.throws(() => parseReviewRows([HEADERS, row, row]), /Duplicate Job ID/);
});

test("AI roles requiring production ML are capped and explained", () => {
  const llm = assessMatch(
    profile,
    "AI Engineer",
    "Build LLM apps with LangChain, TypeScript and Node.js.",
  );
  assert.deepEqual(llm.mlGaps, []);
  assert.ok(llm.matchScore > 45);
  const ml = assessMatch(
    profile,
    "AI Engineer",
    "Train models with PyTorch, deploy with MLOps, Python required.",
  );
  assert.ok(ml.mlGaps.includes("PyTorch"));
  assert.ok(ml.matchScore <= 45);
  assert.match(ml.factual, /production ML experience you have not listed/);
});

test("unknown location preferences do not filter; set ones do", () => {
  assert.equal(locationFits(profile, "San Francisco, CA"), true);
  const india = {
    locations: ["Hyderabad", "Bengaluru"],
    remotePreference: true,
  };
  assert.equal(locationFits(india, "Remote, India"), true);
  assert.equal(locationFits(india, "Hyderabad, India"), true);
  assert.equal(locationFits(india, "New York, NY"), false);
  assert.equal(locationFits(india, "Remote"), true);
  assert.equal(locationFits(india, "Remote - APAC"), true);
  assert.equal(locationFits(india, "Remote, United States"), false);
  assert.equal(locationFits(india, "Remote, Bangalore"), true);
  assert.equal(
    locationFits({ ...india, remotePreference: false }, "Remote"),
    false,
  );
});

test("email message attaches the PDF and rejects header injection", () => {
  const pdf = Buffer.from("%PDF-1.4 test");
  const raw = Buffer.from(
    messageRaw(
      "me@example.com",
      "jobs@example.com",
      "Hi\r\nBcc: x@y.z",
      "Body",
      "cv.pdf",
      pdf,
    ),
    "base64url",
  ).toString();
  assert.match(raw, /Content-Type: application\/pdf/);
  assert.doesNotMatch(raw, /\r\nBcc:/);
  assert.throws(() =>
    messageRaw(
      "me@example.com",
      "a@b.com\r\nBcc: c@d.com",
      "s",
      "b",
      "cv.pdf",
      pdf,
    ),
  );
  assert.throws(() =>
    messageRaw(
      "me@example.com",
      "jobs@example.com",
      "s",
      "b",
      "cv.pdf",
      Buffer.from("nope"),
    ),
  );
});

test("junior/mid seniority filter", async () => {
  const { seniorityFits } = await import("../apps/api/dist/workflow-rules.js");
  for (const t of [
    "Full Stack Engineer",
    "AI Engineer II",
    "Software Engineer - Fullstack",
    "Junior Full Stack Developer",
  ])
    assert.equal(seniorityFits(t), true, t);
  for (const t of [
    "Senior Full Stack Engineer",
    "Sr. AI Engineer",
    "Staff Software Engineer - Fullstack",
    "Lead Full Stack AI Engineer",
    "Engineering Manager - AI",
    "Principal AI Engineer",
  ])
    assert.equal(seniorityFits(t), false, t);
});

test("employers who refuse automated applications are respected", async () => {
  const { forbidsAutomation } =
    await import("../apps/api/dist/workflow-rules.js");
  assert.equal(
    forbidsAutomation("we kindly ask for no automated applications."),
    true,
  );
  assert.equal(forbidsAutomation("No AI-generated applications please"), true);
  assert.equal(
    forbidsAutomation("We automate workflows for applications at scale."),
    false,
  );
});

test("hiring posts: obfuscated and hiring-mailbox emails are found, others are not", async () => {
  const { applicationEmail } =
    await import("../apps/api/dist/workflow-rules.js");
  assert.equal(
    applicationEmail("Interested? Email me at alex [at] acme [dot] io", true)
      .email,
    "alex@acme.io",
  );
  assert.equal(
    applicationEmail("Our team: jobs@acme.io", true).email,
    "jobs@acme.io",
  );
  assert.equal(applicationEmail("Our team: jobs@acme.io", false).email, "");
  assert.equal(
    applicationEmail("Questions about privacy: privacy@acme.io", true).email,
    "",
  );
});

test("new company boards and company websites are detected from links", async () => {
  const { boardsIn, companyWebsite } =
    await import("../apps/api/dist/sources.js");
  assert.deepEqual(
    boardsIn([
      "https://jobs.ashbyhq.com/Acme/123",
      "https://boards.greenhouse.io/foo/jobs/1",
      "https://jobs.lever.co/bar",
    ]),
    [
      { source: "ashby", board: "acme" },
      { source: "greenhouse", board: "foo" },
      { source: "lever", board: "bar" },
    ],
  );
  assert.equal(
    companyWebsite([
      "https://www.linkedin.com/company/x",
      "https://acme.io/about",
    ]),
    "https://acme.io",
  );
});
