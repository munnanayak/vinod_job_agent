import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  formTarget,
  matchesApplicationPage,
} from "../apps/api/dist/form-target.js";
const role = "8476b849-fa2b-48f6-a5d8-a2dc5ea80f3c";
const base = `https://app.whitecarrot.io/profile-builder/role/${role}/user/`;
test("Whitecarrot email and personalized steps retain the approved role on server and browser", () => {
  const target = formTarget(base + "guest?jobBoard=linkedin");
  assert.equal(target.provider, "Whitecarrot");
  const ctx = { URL };
  runInNewContext(
    readFileSync(
      new URL("../apps/form-assistant/join-flow.js", import.meta.url),
      "utf8",
    ),
    ctx,
  );
  for (const url of [
    base + "guest",
    base + "984ffdfe-e137-4b06-85a7-1670eb0c81b8?step=2",
  ]) {
    assert.equal(matchesApplicationPage(target.identity, url), true);
    assert.equal(ctx.joinPageMatches(target.identity, url), true);
  }
  for (const url of [
    base.replace(role, "00000000-fa2b-48f6-a5d8-a2dc5ea80f3c") + "guest",
    base.replace("app.whitecarrot.io", "evil.test") + "guest",
    base + "guest/other",
    base.replace("https:", "http:") + "guest",
  ]) {
    assert.equal(matchesApplicationPage(target.identity, url), false);
    assert.equal(ctx.joinPageMatches(target.identity, url), false);
  }
  assert.equal(ctx.joinButtonKind("Get started"), "next");
  assert.equal(ctx.joinButtonKind("Next step"), "next");
  assert.equal(ctx.joinButtonKind("Submit application"), "submit");
});
