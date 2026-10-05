import test from "node:test";
import assert from "node:assert/strict";
import { experienceFits } from "../apps/api/dist/experience.js";

test("experience cap checks required minimums and keeps eligible ranges", () => {
  assert.equal(
    experienceFits("Requires 4-7 years of software development experience."),
    false,
  );
  assert.equal(
    experienceFits("At least five years building web applications."),
    false,
  );
  assert.equal(
    experienceFits("Requires 2–5 years of professional experience."),
    true,
  );
  assert.equal(experienceFits("3+ years of software experience."), true);
  assert.equal(
    experienceFits(
      "Minimum 2 years of software experience and 4 years building React applications.",
    ),
    false,
  );
});

test("company ages, optional requirements and damaged descriptions stay reviewable", () => {
  for (const description of [
    "We have more than 30 years of experience in IT services.",
    "With more than 100 years of experience, we build systems.",
    "Founded 13 years ago, we’re working with retailers.",
    "Our consulting partner with 18 years of experience driven by a senior team.",
    "2 years experience required. Preferred qualifications: 5+ years of experience.",
    "3+ years of professional software experience. 5+ years preferred but not required.",
    "Contract duration: 5 years. Knowledge of JavaScript required.",
    "Experience: 23 years Job Overview: Medior developer.",
    "Developer with 3 5 years of experience.",
    "Bachelor's degree with 3+ years of experience or 6+ years equivalent.",
    "Experience not specified.",
  ])
    assert.equal(experienceFits(description), true, description);
});
