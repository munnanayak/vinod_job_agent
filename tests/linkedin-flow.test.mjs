import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const flow = readFileSync(
  new URL("../apps/form-assistant/linkedin-flow.js", import.meta.url),
  "utf8",
);
const fill = readFileSync(
  new URL("../apps/form-assistant/fill.js", import.meta.url),
  "utf8",
);
test("Easy Apply binds exact numeric job and recognizes only non-final navigation or explicit submit", () => {
  const ctx = { URL };
  runInNewContext(flow, ctx);
  assert.equal(
    ctx.linkedinJobIdentity(
      "https://www.linkedin.com/jobs/view/123/?tracking=x",
    ),
    "linkedin:jobs:123",
  );
  for (const url of [
    "https://evil.test/jobs/view/123/",
    "https://www.linkedin.com/jobs/search/",
    "https://user@www.linkedin.com/jobs/view/123/",
  ])
    assert.equal(ctx.linkedinJobIdentity(url), null);
  assert.equal(ctx.linkedinStepAction(" Review "), "next");
  assert.equal(ctx.linkedinStepAction("Submit application"), "submit");
  for (const label of [
    "Save",
    "Follow",
    "Send message",
    "Continue with Google",
    "Apply to other jobs",
  ])
    assert.equal(ctx.linkedinStepAction(label), null);
});
test("LinkedIn filler ignores all fields outside its application modal and supports fieldless review", () => {
  let modalQueries = 0;
  const root = {
    querySelectorAll() {
      modalQueries++;
      return [];
    },
  };
  const ctx = {
    URL,
    location: { href: "https://www.linkedin.com/jobs/view/123/" },
    document: {
      querySelector() {
        return root;
      },
      querySelectorAll() {
        throw Error("Must not scan social page fields");
      },
    },
  };
  runInNewContext(fill, ctx);
  assert.deepEqual(
    Array.from(
      ctx.fillApplication({ identity: "linkedin:jobs:123" }, "questions"),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      ctx.fillApplication({ identity: "linkedin:jobs:123" }, "unanswered"),
    ),
    [],
  );
  assert.ok(modalQueries > 0);
  assert.throws(
    () => ctx.fillApplication({ identity: "linkedin:jobs:999" }, "questions"),
    /Wrong/,
  );
  ctx.document.querySelector = () => null;
  assert.throws(
    () => ctx.fillApplication({ identity: "linkedin:jobs:123" }, "questions"),
    /modal/,
  );
});

test("Easy Apply pauses on missing answers and validation, navigates after correction, and stops on job change", async () => {
  let interval,
    clicks = 0,
    missing = ["Mobile phone number"],
    invalid = false;
  const requests = [],
    messages = [];
  const control = {
    id: "phone",
    name: "phone",
    type: "tel",
    labels: [],
    getClientRects: () => [1],
    getAttribute: () => (invalid ? "true" : null),
    validity: { valid: true },
  };
  const next = {
    textContent: "Next",
    getClientRects: () => [1],
    click() {
      clicks++;
    },
  };
  const modal = {
    innerText: "Contact info",
    querySelectorAll(selector) {
      if (selector === "input,textarea,select") return [control];
      if (selector === "button") return [next];
      return [];
    },
  };
  const location = {
    href: "https://www.linkedin.com/jobs/view/123/#job-agent=" + "a".repeat(64),
  };
  const ctx = {
    URL,
    location,
    history: { replaceState() {} },
    document: {
      querySelector: () => modal,
      querySelectorAll: () => [],
      createElement: () => ({ addEventListener() {} }),
    },
    fillApplication(packet, mode) {
      return mode === "questions"
        ? ["Mobile phone number"]
        : mode === "unanswered"
          ? missing
          : {};
    },
    setInterval(fn) {
      interval = fn;
      return 1;
    },
    clearInterval() {},
  };
  runInNewContext(flow, ctx);
  await ctx.linkedinEasyApply({
    code: "a".repeat(64),
    auto: false,
    button: { click() {} },
    panel: { append() {} },
    show: (text) => messages.push(text),
    async ask(message) {
      requests.push(message);
      return {
        ok: true,
        data:
          message.type === "claim"
            ? {
                identity: "linkedin:jobs:123",
                reportToken: "b".repeat(64),
                answers: {},
              }
            : { answers: {} },
      };
    },
  });
  const tick = async () => {
    interval();
    await new Promise(setImmediate);
  };
  await tick();
  assert.equal(clicks, 0);
  assert.match(messages.at(-1), /Needs your input/);
  missing = [];
  invalid = true;
  await tick();
  assert.equal(clicks, 0);
  invalid = false;
  await tick();
  assert.equal(clicks, 1);
  assert.equal(requests.filter((x) => x.type === "submitted").length, 0);
  location.href = "https://www.linkedin.com/jobs/view/456/";
  await tick();
  assert.equal(clicks, 1);
  assert.match(messages.at(-1), /Job changed/);
});

test("automatic submission waits ten seconds, rechecks approval, and records only confirmation", async () => {
  let interval,
    now = 100000,
    submittedClicks = 0,
    text = "Review application";
  const requests = [];
  const submit = {
    textContent: "Submit application",
    isConnected: true,
    getClientRects: () => [1],
    addEventListener() {},
    click() {
      submittedClicks++;
    },
  };
  const modal = {
    get innerText() {
      return text;
    },
    querySelectorAll(selector) {
      return selector === "button" ? [submit] : [];
    },
  };
  const ctx = {
    URL,
    Date: { now: () => now },
    location: { href: "https://www.linkedin.com/jobs/view/123/" },
    history: { replaceState() {} },
    document: {
      querySelector: () => modal,
      querySelectorAll: () => [],
      createElement: () => ({ addEventListener() {} }),
    },
    fillApplication: () => [],
    setInterval(fn) {
      interval = fn;
      return 1;
    },
    clearInterval() {},
  };
  runInNewContext(flow, ctx);
  await ctx.linkedinEasyApply({
    code: "a".repeat(64),
    auto: true,
    button: { click() {} },
    panel: { append() {} },
    show() {},
    async ask(message) {
      requests.push(message);
      return {
        ok: true,
        data:
          message.type === "claim"
            ? {
                identity: "linkedin:jobs:123",
                reportToken: "b".repeat(64),
                answers: {},
              }
            : { answers: {} },
      };
    },
  });
  const tick = async () => {
    interval();
    await new Promise(setImmediate);
  };
  await tick();
  assert.equal(submittedClicks, 0);
  now += 9999;
  await tick();
  assert.equal(submittedClicks, 0);
  now++;
  await tick();
  assert.equal(submittedClicks, 1);
  assert.equal(
    requests.filter((x) => x.type === "draft" && x.questions.length === 0)
      .length,
    2,
  );
  assert.equal(requests.filter((x) => x.type === "submitted").length, 0);
  text = "Your application was sent";
  await tick();
  assert.equal(requests.filter((x) => x.type === "submitted").length, 1);
});

test("Apply detection handles new top card and identical sticky duplicates but rejects conflicting actions", () => {
  const ctx = { URL };
  runInNewContext(flow, ctx);
  const node = (text, href = "") => ({
    innerText: text,
    disabled: false,
    getClientRects: () => [1],
    contains: () => false,
    getAttribute: (name) => (name === "href" ? href : null),
  });
  const a = node("Apply"),
    b = node("Apply");
  assert.equal(
    ctx.linkedinApplyButtons({ querySelectorAll: () => [a, b] }).length,
    1,
  );
  assert.equal(
    ctx.linkedinApplyButtons({
      querySelectorAll: () => [a, node("Easy Apply")],
    }).length,
    2,
  );
  assert.equal(
    ctx.linkedinApplyButtons({ querySelectorAll: () => [node("Saved"), a] })[0],
    a,
  );
});
