import test from "node:test";
import assert from "node:assert/strict";
import {
  boardCandidates,
  parseAlert,
  sameRole,
} from "../apps/api/dist/linkedin.js";

test("plain-text job alert blocks become jobs with canonical links", () => {
  const text = [
    "Your job alert for full stack developer in Bengaluru",
    "12 new jobs match your preferences.",
    "",
    "Full Stack Engineer",
    "UST",
    "Bengaluru, Karnataka, India",
    "You’d be a top applicant",
    "View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&refId=x",
    "",
    "---------------------------------------------------------",
    "",
    "New jobs from your other alerts",
    '<strong class="font-bold">Full Stack Engineer</strong> jobs in New Delhi',
    "Jobs in Asia",
    "AI Engineer",
    "Sarvam AI",
    "India (Remote)",
    "Easy Apply",
    "View job: https://www.linkedin.com/comm/jobs/view/4099999999/?trackingId=def",
  ].join("\n");
  assert.deepEqual(parseAlert(text, ""), [
    {
      id: "4012345678",
      title: "Full Stack Engineer",
      company: "UST",
      location: "Bengaluru, Karnataka, India",
      url: "https://www.linkedin.com/jobs/view/4012345678/",
    },
    {
      id: "4099999999",
      title: "AI Engineer",
      company: "Sarvam AI",
      location: "India (Remote)",
      url: "https://www.linkedin.com/jobs/view/4099999999/",
    },
  ]);
});

test("HTML alerts: link wraps title, 'Company · Location' follows, logo link ignored", () => {
  const html = `<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4011111111/?x=1&amp;y=2"><img alt="logo"></a></td>
    <td><a href="https://www.linkedin.com/comm/jobs/view/4011111111/?x=1">Full-Stack Developer</a><p>EMTensor GmbH · Bengaluru</p><p>2 days ago</p></td></tr></table>`;
  assert.deepEqual(parseAlert("", html), [
    {
      id: "4011111111",
      title: "Full-Stack Developer",
      company: "EMTensor GmbH",
      location: "Bengaluru",
      url: "https://www.linkedin.com/jobs/view/4011111111/",
    },
  ]);
});

test("single-job emails fall back to the subject line", () => {
  const jobs = parseAlert(
    "",
    '<a href="https://www.linkedin.com/comm/jobs/view/4022222222/">View job</a>',
    "Nexifyr is hiring a Backend Engineer - Node.Js",
  );
  assert.equal(jobs[0].company, "Nexifyr");
  assert.equal(jobs[0].title, "Backend Engineer - Node.Js");
});

test("matching a LinkedIn job to the company's own board", () => {
  assert.equal(sameRole("Full Stack Engineer", "Full-Stack Engineer"), true);
  assert.equal(sameRole("AI Engineer", "Senior AI Engineer, Platform"), false);
  assert.deepEqual(boardCandidates("Hevo Data Pvt Ltd"), [
    "hevodata",
    "hevo-data",
    "hevo",
  ]);
});
