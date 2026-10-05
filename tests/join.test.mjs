import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  formTarget,
  formJobOpen,
  FormSessions,
} from "../apps/api/dist/forms.js";

const listing =
  "https://join.com/companies/aimitechnology/16658631-agentic-ai-engineer";
const spontaneous =
  "https://join.com/companies/aimitechnology/spontaneous-application";
const script = readFileSync(
  new URL("../apps/form-assistant/join-flow.js", import.meta.url),
  "utf8",
);
const context = { URL };
runInNewContext(script, context);

test("JOIN bindings distinguish a role from a spontaneous application", () => {
  assert.equal(formTarget(listing).provider, "JOIN");
  assert.notEqual(
    formTarget(listing).identity,
    formTarget(spontaneous).identity,
  );
  assert.equal(
    formTarget(
      "https://join.com.evil.test/companies/aimitechnology/spontaneous-application",
    ),
    null,
  );
  assert.equal(
    context.joinPageMatches(formTarget(listing).identity, spontaneous),
    false,
  );
  assert.equal(
    context.joinPageMatches(
      formTarget(spontaneous).identity,
      "https://join.com/companies/aimitechnology/apply/authentication",
    ),
    true,
  );
  assert.equal(
    context.joinPageMatches(
      formTarget(listing).identity,
      "https://join.com/companies/aimitechnology/apply/authentication",
    ),
    false,
  );
  assert.equal(
    context.joinPageMatches(
      formTarget(listing).identity,
      "https://join.com/companies/aimitechnology/apply/details?jobId=16658631",
    ),
    true,
  );
  assert.equal(
    context.joinPageMatches(
      formTarget(listing).identity,
      "https://join.com/companies/aimitechnology/apply/details?jobId=999",
    ),
    false,
  );
});

test("JOIN archived pages skip the exact approved job without using another vacancy", async () => {
  const identity = formTarget(listing).identity;
  assert.equal(
    await formJobOpen(
      identity,
      async () =>
        new Response(
          "<h2>This job is no longer available</h2><a>Spontaneous Application</a>",
        ),
    ),
    false,
  );
  assert.equal(
    await formJobOpen(
      identity,
      async () => new Response("<button>Apply now</button>"),
    ),
    true,
  );
  await assert.rejects(
    () =>
      formJobOpen(identity, async () => new Response("limit", { status: 429 })),
    /retry later/,
  );
  const sessions = new FormSessions();
  const { code } = sessions.issue("job", "hash", identity);
  assert.throws(
    () => sessions.consumeClosed(code, spontaneous),
    /Not this job/,
  );
  assert.equal(sessions.consumeClosed(code, listing).jobId, "job");
});

test("JOIN navigation recognizes only form steps and explicit submission buttons", () => {
  assert.equal(context.joinButtonKind("Apply now"), "apply");
  assert.equal(context.joinButtonKind("Continue"), "next");
  assert.equal(context.joinButtonKind("Submit application"), "submit");
  assert.equal(context.joinButtonKind("Continue with Google"), null);
  assert.equal(context.joinButtonKind("Spontaneous Application"), null);
  assert.equal(context.joinButtonKind("Accept all cookies"), null);
});

test("JOIN extension pauses at login then resumes filling a matching form step", async () => {
  const content = readFileSync(
    new URL("../apps/form-assistant/join-content.js", import.meta.url),
    "utf8",
  );
  const packet = {
    identity: formTarget(spontaneous).identity,
    reportToken: "a".repeat(64),
    fields: { email: "me@example.com" },
    expires: Date.now() + 60000,
  };
  const page = new URL(
    "https://join.com/companies/aimitechnology/apply/authentication",
  );
  const panel = { append() {}, textContent: "" };
  const banner = { style: {}, attachShadow: () => panel, isConnected: true };
  const timers = [],
    filled = [],
    requests = [];
  const doc = {
    body: { innerText: "Sign in", append() {} },
    createElement: (tag) =>
      tag === "div" ? banner : { style: {}, addEventListener() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const sandbox = {
    ...context,
    URL,
    location: page,
    document: doc,
    history: { replaceState() {} },
    chrome: {
      runtime: {
        sendMessage(message, reply) {
          requests.push(message.type);
          reply({
            ok: true,
            data:
              message.type === "join-load"
                ? packet
                : { answers: { Name: "Candidate" } },
          });
        },
      },
    },
    fillApplication(data, mode) {
      if (mode === "fill") filled.push(data);
      return mode === "questions" ? ["Name"] : [];
    },
    setInterval(fn) {
      timers.push(fn);
      return 1;
    },
    clearInterval() {},
  };
  await runInNewContext(content, sandbox);
  assert.match(panel.textContent, /sign-in/);
  assert.equal(requests.includes("submitted"), false);
  page.pathname = "/companies/aimitechnology/apply/details";
  doc.body.innerText = "Application details";
  timers[0]();
  await new Promise(setImmediate);
  assert.equal(requests.includes("draft"), true);
  assert.equal(filled.at(-1).answers.Name, "Candidate");
});
