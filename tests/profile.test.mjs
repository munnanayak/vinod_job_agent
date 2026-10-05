import test from "node:test";
import assert from "node:assert/strict";
import { candidateProfileSchema } from "../packages/types/dist/index.js";
const valid = {
  name: "Test Candidate",
  currentTitle: "Developer",
  yearsOfExperience: 2,
  locations: ["Hyderabad"],
  remotePreference: true,
  targetRoles: ["Full Stack Developer"],
  excludedRoles: [],
  minimumSalary: null,
  currency: "INR",
  noticePeriodDays: null,
  workAuthorization: "",
  skills: ["TypeScript"],
  education: [],
  experience: [],
  projects: [],
};
test("profile validation rejects invalid and unknown data", () => {
  assert.equal(candidateProfileSchema.safeParse(valid).success, true);
  for (const change of [
    { name: " " },
    { email: "not-an-email" },
    { githubUrl: "javascript:alert(1)" },
    { portfolioUrl: "ftp://example.com" },
    { yearsOfExperience: -1 },
    { skills: [] },
    { targetRoles: [] },
    { minimumSalary: -1 },
    { noticePeriodDays: 1.5 },
    { currency: "rupees" },
    { ownerKey: "another-user" },
    { experience: [{ company: "Company", title: "" }] },
  ]) {
    assert.equal(
      candidateProfileSchema.safeParse({ ...valid, ...change }).success,
      false,
      JSON.stringify(change),
    );
  }
});
test(
  "profile create, read, update and invalid input preservation",
  { skip: !process.env.TEST_API_URL },
  async () => {
    const url = `${process.env.TEST_API_URL}/profile`;
    assert.equal((await fetch(url)).status, 200);
    const original = (await (await fetch(url)).json()).profile;
    assert.equal(
      original,
      null,
      "Integration test must run against an empty test database.",
    );
    const put = (body) =>
      fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Job-Agent": "1" },
        body: JSON.stringify(body),
      });
    const created = await put(valid);
    assert.equal(created.status, 200);
    const first = (await created.json()).profile;
    assert.ok(first.id);
    assert.equal(first.ownerKey, undefined);
    const next = {
      ...valid,
      name: "Updated Candidate",
      skills: ["TypeScript", "React"],
      experience: [
        {
          company: "Example",
          title: "Engineer",
          details: "Built internal tools",
        },
      ],
    };
    const updated = (await (await put(next)).json()).profile;
    assert.equal(updated.id, first.id);
    assert.deepEqual(
      (await (await fetch(url)).json()).profile.skills,
      next.skills,
    );
    assert.equal((await put({ ...next, yearsOfExperience: -3 })).status, 400);
    assert.equal(
      (await (await fetch(url)).json()).profile.yearsOfExperience,
      2,
    );
  },
);

test("unknown remote preference and contact defaults remain explicit", () => {
  const profile = candidateProfileSchema.parse({
    ...valid,
    remotePreference: null,
  });
  assert.equal(profile.remotePreference, null);
  assert.equal(profile.email, "");
});
