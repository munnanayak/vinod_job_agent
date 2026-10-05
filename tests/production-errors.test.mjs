import test from "node:test";
import assert from "node:assert/strict";
import { GoogleIntegration } from "../apps/api/dist/google.js";
import { ApiErrors } from "../apps/api/dist/api-errors.js";

test("an unreadable saved Google token gives recovery instructions and can be disconnected", async () => {
  const oldKey = process.env.TOKEN_ENCRYPTION_KEY;
  const oldSheet = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "test-sheet";
  let deleted = false;
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkCalls++;
    throw Error("unexpected request");
  };
  const google = new GoogleIntegration({
    client: {
      googleConnection: {
        findUnique: async () => ({ encryptedRefreshToken: "invalid.token" }),
        delete: async () => {
          deleted = true;
        },
      },
    },
  });
  try {
    await assert.rejects(
      () => google.readSheet(),
      (error) => {
        assert.equal(error.getStatus(), 412);
        assert.match(error.message, /TOKEN_ENCRYPTION_KEY/);
        assert.match(error.message, /reconnect/);
        return true;
      },
    );
    await google.disconnect();
    assert.equal(deleted, true);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = oldKey;
    if (oldSheet === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = oldSheet;
  }
});

test("API errors explain schema failures without leaking database details", () => {
  let status, body;
  const filter = new ApiErrors();
  filter.logger = { error: () => {} };
  filter.catch(
    Object.assign(Error("secret database connection details"), {
      code: "P2022",
    }),
    {
      switchToHttp: () => ({
        getRequest: () => ({
          method: "POST",
          url: "/api/workflow/forms/batch",
        }),
        getResponse: () => ({
          status: (value) => {
            status = value;
            return {
              json: (value) => {
                body = value;
              },
            };
          },
        }),
      }),
    },
  );
  assert.equal(status, 503);
  assert.match(body.message, /pnpm db:migrate/);
  assert.ok(body.requestId);
  assert.doesNotMatch(JSON.stringify(body), /secret/);
});
