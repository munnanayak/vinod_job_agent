import test from "node:test";
import assert from "node:assert/strict";
import { externalTarget, formTarget } from "../apps/api/dist/form-target.js";
test("generic targets remain separate from supported discovery and reject credentials or unsafe origins", () => {
  const url = "https://careers.example.com/jobs/123/apply?source=linkedin";
  assert.equal(formTarget(url), null);
  assert.equal(externalTarget(url).url, url);
  for (const value of [
    "http://careers.example.com/apply",
    "https://user:pass@careers.example.com/apply",
    "https://localhost/apply",
    "https://127.0.0.1/apply",
    "https://192.168.1.1/apply",
    "https://accounts.google.com/login",
    "https://www.linkedin.com/jobs/view/123/",
  ])
    assert.equal(externalTarget(value), null);
});
