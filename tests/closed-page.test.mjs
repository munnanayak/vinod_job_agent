import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(
  new URL("../apps/form-assistant/content.js", import.meta.url),
  "utf8",
);
for (const path of [
  "/embed/job_board?for=gitlab&error=true",
  "/gitlab?error=true",
]) {
  test(`extension skips closed redirect ${path} without waiting for fields`, async () => {
    const code = "a".repeat(64);
    const page = new URL(`https://job-boards.greenhouse.io${path}`);
    const storage = new Map([
      [
        "job-agent-preparing",
        JSON.stringify({ code, auto: false, expires: Date.now() + 60000 }),
      ],
    ]);
    const messages = [];
    const panel = { innerHTML: "" };
    const banner = { style: {}, setAttribute() {}, attachShadow: () => panel };
    await runInNewContext(script, {
      URL,
      location: page,
      history: { replaceState() {} },
      sessionStorage: {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      document: { createElement: () => banner, body: { append() {} } },
      chrome: {
        runtime: {
          sendMessage(message, reply) {
            messages.push(message);
            reply({ ok: true, data: { next: null } });
          },
        },
      },
      fillApplication() {
        throw Error("Closed pages must not try to fill a form");
      },
      setTimeout() {
        throw Error("Closed pages must not wait for a form");
      },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
      { type: "closed", token: code },
    ]);
    assert.match(panel.innerHTML, /Skipped/);
    assert.equal(storage.has("job-agent-preparing"), false);
  });
}
