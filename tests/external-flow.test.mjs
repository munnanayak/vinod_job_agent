import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
test("shared employer loop fills its form, pauses for missing answers, and verifies a planned Next action", async () => {
  const url = "https://careers.example.com/jobs/123/apply";
  let interval,
    missing = ["Experience"],
    clicks = 0;
  const requests = [];
  const control = {
    type: "text",
    labels: [],
    value: "",
    validity: { valid: true },
    getClientRects: () => [1],
    getAttribute: () => null,
  };
  const next = {
    textContent: "Next step",
    isConnected: true,
    getClientRects: () => [1],
    getAttribute: () => null,
    click() {
      clicks++;
    },
    addEventListener() {},
  };
  const form = {
    getClientRects: () => [1],
    getAttribute: () => null,
    contains: () => false,
    setAttribute() {},
    querySelector: () => control,
    querySelectorAll(selector) {
      return selector.includes("button") ? [next] : [control];
    },
  };
  const panel = { textContent: "", append() {} };
  const ctx = {
    URL,
    history: { replaceState() {} },
    location: {
      href: url + "#job-agent=" + "a".repeat(64),
      origin: "https://careers.example.com",
      hash: "#job-agent=" + "a".repeat(64),
    },
    document: {
      body: { append() {}, innerText: "Application" },
      querySelector: () => ({ textContent: "Developer" }),
      querySelectorAll(selector) {
        return selector === 'form,main,[role="main"]' ? [form] : [];
      },
      createElement() {
        return { style: {}, attachShadow: () => panel, addEventListener() {} };
      },
    },
    chrome: {
      runtime: {
        sendMessage(message, reply) {
          requests.push(message);
          reply({
            ok: true,
            data:
              message.type === "external-load"
                ? null
                : message.type === "claim"
                  ? {
                      identity: "external:" + encodeURIComponent(url),
                      reportToken: "b".repeat(64),
                      jobTitle: "Developer",
                    }
                  : message.type === "draft"
                    ? { answers: {} }
                    : message.type === "plan"
                      ? { action: "click", buttonId: 0, pages: [] }
                      : {},
          });
        },
      },
    },
    fillApplication(packet, mode) {
      return mode === "questions"
        ? ["Experience"]
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
  await runInNewContext(
    readFileSync(
      new URL("../apps/form-assistant/external-content.js", import.meta.url),
      "utf8",
    ),
    ctx,
  );
  const tick = async () => {
    interval();
    await new Promise(setImmediate);
  };
  await tick();
  assert.equal(clicks, 0);
  assert.match(panel.textContent, /Needs your input/);
  missing = [];
  await tick();
  assert.equal(clicks, 1);
  assert.equal(requests.filter((x) => x.type === "plan").length, 1);
  assert.equal(requests.filter((x) => x.type === "submitted").length, 0);
});
