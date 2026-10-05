import test from "node:test";
import assert from "node:assert/strict";
import { parseNaukriAlert } from "../apps/api/dist/naukri.js";

const link = (position) =>
  `https://cm.naukri.com?data=${encodeURIComponent(JSON.stringify({ communicationId: "abc", clickPosition: position }))}`;
const card = (position, cells) =>
  `<a href="${link(position).replace(/&/g, "&amp;")}"><table>${cells.map((c) => `<tr><td>${c}</td></tr>`).join("")}</table></a><a href="${link(position + 1)}">Apply</a>`;

test("Naukri alert cards become jobs; buttons and ratings are ignored", () => {
  const jobs = parseNaukriAlert(
    card(1, [
      "Fullstack Developer",
      "Hewlett Packard Ent...",
      "4.1",
      "Bengaluru",
      "Not disclosed",
      "Urgent hiring",
    ]) +
      card(3, [
        "Mern Stack Developer",
        "Damco Solutions",
        "Pune, Bengaluru",
        "4-9 Lacs PA",
      ]) +
      '<a href="https://example.com/x"><b>Other</b><i>site</i><u>link</u></a>',
  );
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map(({ title, company, location, salary }) => [
      title,
      company,
      location,
      salary,
    ]),
    [
      [
        "Fullstack Developer",
        "Hewlett Packard Ent",
        "Bengaluru",
        "Not disclosed",
      ],
      [
        "Mern Stack Developer",
        "Damco Solutions",
        "Pune, Bengaluru",
        "4-9 Lacs PA",
      ],
    ],
  );
  assert.notEqual(jobs[0].id, jobs[1].id);
  assert.match(jobs[0].url, /^https:\/\/cm\.naukri\.com\?data=/);
});
