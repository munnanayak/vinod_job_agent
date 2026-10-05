import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("LinkedIn new-tab handoff stays bound to its armed opener and runs once", async () => {
  const script = readFileSync(
    new URL("../apps/form-assistant/background.js", import.meta.url),
    "utf8",
  );
  const storage = {},
    requests = [],
    updates = [],
    reloads = [];
  let messageHandler, updatedHandler;
  runInNewContext(script, {
    URL,
    AbortSignal,
    importScripts() {},
    console,
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) {
            messageHandler = fn;
          },
        },
      },
      storage: {
        session: {
          async set(entries) {
            Object.assign(storage, entries);
          },
          async get(key) {
            return { [key]: storage[key] };
          },
          async remove(key) {
            delete storage[key];
          },
        },
      },
      tabs: {
        onUpdated: {
          addListener(fn) {
            updatedHandler = fn;
          },
        },
        onRemoved: { addListener() {} },
        async update(id, options) {
          updates.push({ id, ...options });
        },
        async reload(id) {
          reloads.push(id);
        },
      },
    },
    async fetch(url, options) {
      requests.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({
          openUrl:
            "https://jobs.lever.co/acme/12345678/apply#job-agent=" +
            "b".repeat(64),
        }),
      };
    },
  });
  const armed = await new Promise((resolve) =>
    messageHandler(
      { type: "linkedin-arm", token: "a".repeat(64), auto: false },
      { tab: { id: 7, url: "https://www.linkedin.com/jobs/view/12345/" } },
      resolve,
    ),
  );
  assert.equal(armed.ok, true);
  updatedHandler(
    8,
    { url: "https://jobs.lever.co/acme/12345678/apply" },
    { openerTabId: 99 },
  );
  await new Promise(setImmediate);
  assert.equal(requests.length, 0);
  for (let i = 0; i < 2; i++)
    updatedHandler(
      9,
      { url: "https://jobs.lever.co/acme/12345678/apply" },
      { openerTabId: 7 },
    );
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].body.pageUrl,
    "https://www.linkedin.com/jobs/view/12345/",
  );
  assert.equal(updates[0].id, 9);
  assert.match(updates[0].url, /#job-agent=b{64}$/);
  assert.deepEqual(reloads, [9]);
  assert.equal(storage["linkedin-bridge-7"], undefined);
  await new Promise((resolve) =>
    messageHandler(
      { type: "linkedin-arm", token: "c".repeat(64), auto: false },
      { tab: { id: 11, url: "https://www.linkedin.com/jobs/view/56789/" } },
      resolve,
    ),
  );
  updatedHandler(
    11,
    { url: "https://jobs.lever.co/acme/12345678/apply" },
    { openerTabId: 99 },
  );
  await new Promise(setImmediate);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].body.pageUrl,
    "https://www.linkedin.com/jobs/view/56789/",
  );
  assert.equal(updates[1].id, 11);
});
