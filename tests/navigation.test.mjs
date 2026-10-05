import test from "node:test";
import assert from "node:assert/strict";
import { planNavigation } from "../apps/api/dist/navigation.js";

const observation = {
  pageUrl: "https://join.com/companies/acme/apply/details",
  heading: "Application details",
  login: false,
  captcha: false,
  missing: [],
  buttons: [
    { id: 0, label: "Proceed to experience", href: "", withinForm: true },
    { id: 1, label: "Submit application", href: "", withinForm: true },
  ],
};
const response = (choice) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(choice) } }],
    }),
  );
function configured(t) {
  const old = {
    FUELIX_API_KEY: process.env.FUELIX_API_KEY,
    FUELIX_BASE_URL: process.env.FUELIX_BASE_URL,
  };
  process.env.FUELIX_API_KEY = "test-key";
  process.env.FUELIX_BASE_URL = "https://model.example";
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
test("navigation model can select only observed non-final steps", async (t) => {
  configured(t);
  const approved = await planNavigation(observation, async (_, options) => {
    const prompt = JSON.parse(options.body);
    assert.match(prompt.messages[0].content, /untrusted observations/);
    assert.equal(JSON.parse(prompt.messages[1].content).buttons.length, 1);
    return response({ action: "click", buttonId: 0 });
  });
  assert.equal(approved.buttonId, 0);
  assert.equal(
    (
      await planNavigation(observation, async () =>
        response({ action: "click", buttonId: 1 }),
      )
    ).action,
    "manual",
  );
  assert.equal(
    (
      await planNavigation(observation, async () =>
        response({ action: "click", buttonId: 900 }),
      )
    ).action,
    "manual",
  );
});
test("login, CAPTCHA and missing answers block model navigation", async () => {
  for (const patch of [
    { login: true },
    { captcha: true },
    { missing: ["Salary expectation"] },
  ]) {
    assert.equal(
      (
        await planNavigation({ ...observation, ...patch }, async () => {
          throw Error("Model should not run");
        })
      ).action,
      "manual",
    );
  }
});
test("unavailable models leave navigation manual", async (t) => {
  configured(t);
  assert.equal(
    (
      await planNavigation(observation, async () => {
        throw Error("timeout");
      })
    ).action,
    "manual",
  );
});
