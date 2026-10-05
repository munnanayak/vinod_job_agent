import test from "node:test";
import assert from "node:assert/strict";
import { draftAnswers, knownAnswer } from "../apps/api/dist/answers.js";

const profile = {
  name: "Test Candidate",
  currentTitle: "Full Stack Developer",
  currentCity: "Bengaluru",
  linkedinUrl: "https://www.linkedin.com/in/test",
  yearsOfExperience: 2,
  noticePeriodDays: 30,
  locations: ["Hyderabad", "Bengaluru"],
  workAuthorization: "",
  summary: "",
  skills: ["TypeScript"],
  experience: [
    { company: "Bern AI Lab", title: "Full Stack Developer", details: "" },
  ],
  projects: [],
  education: [],
};

test("common questions are answered from the profile", () => {
  assert.equal(knownAnswer("What is your notice period?", profile), "30 days");
  assert.equal(knownAnswer("Years of professional experience", profile), "2");
  assert.equal(knownAnswer("Current location", profile), "Bengaluru");
  assert.equal(knownAnswer("Current company", profile), "Bern AI Lab");
  assert.equal(knownAnswer("LinkedIn Profile", profile), profile.linkedinUrl);
  assert.equal(
    knownAnswer("Are you legally authorized to work in India?", profile),
    null,
    "empty work authorization stays unanswered",
  );
});

test("salary, visa, demographic and consent questions are never answered", async () => {
  for (const q of [
    "Expected CTC",
    "Current salary",
    "Will you require visa sponsorship?",
    "Gender",
    "Do you consent to the privacy policy?",
    "How did you hear about us?",
    "Notice period and expected salary",
  ])
    assert.equal(knownAnswer(q, profile), null, q);
  process.env.FUELIX_API_KEY = "";
  const answers = await draftAnswers(
    profile,
    { company: "Acme", title: "Engineer", description: "" },
    ["Expected CTC", "Notice period"],
  );
  assert.deepEqual(answers, { "Notice period": "30 days" });
});
