import {
  BadRequestException,
  Injectable,
  PreconditionFailedException,
} from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Database } from "./database.js";

// Send applications, read replies and LinkedIn job-alert emails, edit the review sheet.
// gmail.metadata is not requested: when granted it blocks reading message bodies.
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];
const READ = "https://www.googleapis.com/auth/gmail.readonly";

function env(name: string) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new PreconditionFailedException(`${name} is not configured in .env`);
  return value;
}

// Accepts either the spreadsheet ID or its full browser URL.
function spreadsheetId() {
  const value = env("GOOGLE_SHEETS_SPREADSHEET_ID");
  return /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(value)?.[1] ?? value;
}

function tabName() {
  return process.env.GOOGLE_SHEETS_TAB_NAME?.trim() || "Jobs";
}

function key() {
  const hex = env("TOKEN_ENCRYPTION_KEY");
  if (!/^[0-9a-f]{64}$/i.test(hex))
    throw new PreconditionFailedException(
      "TOKEN_ENCRYPTION_KEY must be 64 hex characters",
    );
  return Buffer.from(hex, "hex");
}

function encrypt(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64"))
    .join(".");
}

function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

@Injectable()
export class GoogleIntegration {
  private states = new Map<string, number>();
  private access: { token: string; expires: number } | null = null;
  constructor(private readonly db: Database) {}

  authUrl() {
    const state = randomBytes(24).toString("hex");
    const now = Date.now();
    for (const [s, exp] of this.states) if (exp < now) this.states.delete(s);
    this.states.set(state, now + 10 * 60_000);
    const params = new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      redirect_uri: env("GOOGLE_REDIRECT_URI"),
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async complete(
    code: string | undefined,
    state: string | undefined,
    browserState?: string,
  ) {
    if (!state || !browserState || state !== browserState)
      throw new BadRequestException(
        "Google sign-in must finish in the browser that started it.",
      );
    const expires = state ? this.states.get(state) : undefined;
    if (!state || !expires || expires < Date.now())
      throw new BadRequestException("Google sign-in expired. Start again.");
    this.states.delete(state);
    if (!code) throw new BadRequestException("Google did not return a code.");
    const token = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: env("GOOGLE_REDIRECT_URI"),
    });
    if (!token.refresh_token)
      throw new BadRequestException(
        "Google did not return a refresh token. Remove Job Agent access in your Google account and connect again.",
      );
    const granted = String(token.scope ?? "").split(" ");
    const missing = SCOPES.filter(
      (s) => s.startsWith("https") && !granted.includes(s),
    );
    if (missing.length)
      throw new BadRequestException(
        `Please allow all requested permissions. Missing: ${missing.join(", ")}`,
      );
    const info = await this.json(
      "https://openidconnect.googleapis.com/v1/userinfo",
      token.access_token,
    );
    if (!info.email || info.email_verified === false)
      throw new BadRequestException("Google account email is not verified.");
    const record = {
      email: String(info.email).toLowerCase(),
      encryptedRefreshToken: encrypt(token.refresh_token),
      scopes: granted.join(" "),
    };
    await this.db.client.googleConnection.upsert({
      where: { id: "local" },
      create: { id: "local", ...record },
      update: record,
    });
    this.access = {
      token: token.access_token,
      expires: Date.now() + (token.expires_in - 60) * 1000,
    };
  }

  async status() {
    const c = await this.db.client.googleConnection.findUnique({
      where: { id: "local" },
      select: { email: true, updatedAt: true, scopes: true },
    });
    const granted = c?.scopes.split(" ") ?? [];
    const sheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim()
      ? spreadsheetId()
      : null;
    return {
      connected: Boolean(c),
      email: c?.email ?? null,
      // Connections made before LinkedIn alerts need to reconnect once.
      needsReconnect:
        Boolean(c) &&
        (!granted.includes(READ) ||
          granted.some((g) => g.endsWith("/gmail.metadata"))),
      sheetUrl: sheetId
        ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit`
        : null,
    };
  }

  async disconnect() {
    const c = await this.db.client.googleConnection.findUnique({
      where: { id: "local" },
    });
    if (!c) return;
    // Best effort: revoke at Google, then always forget locally.
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decrypt(c.encryptedRefreshToken) }),
    }).catch(() => undefined);
    await this.db.client.googleConnection.delete({ where: { id: "local" } });
    this.access = null;
  }

  async senderEmail() {
    const c = await this.db.client.googleConnection.findUnique({
      where: { id: "local" },
    });
    if (!c) throw new PreconditionFailedException("Connect Google first.");
    return c.email;
  }

  private async tokenRequest(fields: Record<string, string>) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        ...fields,
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new BadRequestException(
        `Google token request failed: ${data.error ?? response.status}`,
      );
    return data;
  }

  private async accessToken() {
    if (this.access && this.access.expires > Date.now())
      return this.access.token;
    const c = await this.db.client.googleConnection.findUnique({
      where: { id: "local" },
    });
    if (!c) throw new PreconditionFailedException("Connect Google first.");
    const token = await this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: decrypt(c.encryptedRefreshToken),
    });
    this.access = {
      token: token.access_token,
      expires: Date.now() + (token.expires_in - 60) * 1000,
    };
    return this.access.token;
  }

  private async json(
    url: string,
    token?: string,
    init: RequestInit = {},
    attempt = 0,
  ): Promise<any> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token ?? (await this.accessToken())}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => ({}));
    // Per-minute quota: wait and retry reads only. Sends are never retried (no duplicates).
    const limited =
      response.status === 429 ||
      (response.status === 403 &&
        /quota|rate limit/i.test(data.error?.message ?? ""));
    if (limited && (init.method ?? "GET") === "GET" && attempt < 3) {
      await new Promise((resolve) =>
        setTimeout(resolve, 20_000 * (attempt + 1)),
      );
      return this.json(url, token, init, attempt + 1);
    }
    if (!response.ok)
      throw new BadRequestException(
        `Google API error (${response.status}): ${data.error?.message ?? "request failed"}`,
      );
    return data;
  }

  private tabReady = false;
  private async ensureTab() {
    if (this.tabReady) return;
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId())}`;
    const meta = await this.json(`${base}?fields=sheets.properties.title`);
    const exists = (meta.sheets ?? []).some(
      (sheet: { properties?: { title?: string } }) =>
        sheet.properties?.title === tabName(),
    );
    if (!exists)
      await this.json(`${base}:batchUpdate`, undefined, {
        method: "POST",
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: tabName() } } }],
        }),
      });
    this.tabReady = true;
  }

  private range(cells: string) {
    const tab = tabName().replace(/'/g, "''");
    return encodeURIComponent(`'${tab}'!${cells}`);
  }

  private sheetBase() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId())}/values`;
  }

  async readSheet(): Promise<string[][]> {
    await this.ensureTab();
    const data = await this.json(`${this.sheetBase()}/${this.range("A:T")}`);
    return (data.values ?? []).map((row: unknown[]) => row.map(String));
  }

  async writeRange(cells: string, values: string[][]) {
    await this.json(
      `${this.sheetBase()}/${this.range(cells)}?valueInputOption=RAW`,
      undefined,
      { method: "PUT", body: JSON.stringify({ values }) },
    );
  }

  async appendRows(values: string[][]) {
    await this.json(
      `${this.sheetBase()}/${this.range("A:T")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      undefined,
      { method: "POST", body: JSON.stringify({ values }) },
    );
  }

  /** Delete selected rows, using zero-based indexes and preserving the header. */
  async deleteSheetRows(indexes: number[]) {
    if (!indexes.length) return;
    if (indexes.some((i) => !Number.isInteger(i) || i < 1))
      throw new BadRequestException("Only job rows can be deleted.");
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId())}`;
    const meta = await this.json(`${base}?fields=sheets.properties`);
    const sheet = meta.sheets.find(
      (s: { properties: { title: string } }) =>
        s.properties.title === tabName(),
    );
    if (!sheet) throw new BadRequestException("Job sheet tab is missing.");
    await this.json(`${base}:batchUpdate`, undefined, {
      method: "POST",
      body: JSON.stringify({
        requests: [...new Set(indexes)]
          .sort((a, b) => b - a)
          .map((i) => ({
            deleteDimension: {
              range: {
                sheetId: sheet.properties.sheetId,
                dimension: "ROWS",
                startIndex: i,
                endIndex: i + 1,
              },
            },
          })),
      }),
    });
  }

  async sendMail(raw: string): Promise<{ id: string; threadId: string }> {
    return this.json(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      undefined,
      { method: "POST", body: JSON.stringify({ raw }) },
    );
  }

  async threadReplies(threadId: string, sender: string) {
    const data = await this.json(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    );
    return (data.messages ?? [])
      .map(
        (m: {
          id: string;
          snippet?: string;
          payload?: { headers?: { name: string; value: string }[] };
        }) => ({
          id: m.id,
          snippet: m.snippet ?? "",
          from: m.payload?.headers?.find((h) => h.name === "From")?.value ?? "",
        }),
      )
      .filter((m: { from: string }) => !m.from.toLowerCase().includes(sender));
  }

  /**
   * LinkedIn job-alert emails received since `after`. Only messages whose sender
   * is a linkedin.com address are returned; nothing else in the mailbox is read.
   */
  linkedInAlerts(after: Date) {
    // Only LinkedIn's job-alert senders; LinkedIn messages and notifications are never opened.
    return this.alertEmails(
      ["jobalerts-noreply@linkedin.com", "jobs-noreply@linkedin.com"],
      after,
    );
  }

  /** Naukri job-alert emails received since `after`; only Naukri's alert sender is read. */
  naukriAlerts(after: Date) {
    return this.alertEmails(["naukrialerts@naukri.com"], after);
  }

  // Emails from exactly these sender addresses; nothing else in the mailbox is read.
  private async alertEmails(senders: string[], after: Date) {
    const q = `from:(${senders.join(" OR ")}) after:${Math.floor(after.getTime() / 1000)}`;
    const ids: string[] = [];
    let page = "";
    do {
      const list = await this.json(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(q)}${page ? `&pageToken=${page}` : ""}`,
      );
      ids.push(...((list.messages ?? []) as { id: string }[]).map((m) => m.id));
      page = list.nextPageToken ?? "";
    } while (page && ids.length < 200);
    const out: {
      id: string;
      date: Date;
      subject: string;
      text: string;
      html: string;
    }[] = [];
    for (const id of ids.slice(0, 200)) {
      const m = await this.json(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      );
      const header = (name: string) =>
        m.payload?.headers?.find(
          (h: { name: string }) => h.name.toLowerCase() === name,
        )?.value ?? "";
      const from = header("from").toLowerCase().trim();
      if (!senders.some((s) => from === s || from.endsWith(`<${s}>`))) continue;
      const parts: { mimeType: string; data: string }[] = [];
      const walk = (part: {
        mimeType?: string;
        body?: { data?: string };
        parts?: unknown[];
      }) => {
        if (part.body?.data && part.mimeType)
          parts.push({
            mimeType: part.mimeType,
            data: Buffer.from(part.body.data, "base64url").toString("utf8"),
          });
        for (const child of (part.parts ?? []) as (typeof part)[]) walk(child);
      };
      walk(m.payload ?? {});
      out.push({
        id,
        date: new Date(Number(m.internalDate)),
        subject: header("subject"),
        text: parts
          .filter((p) => p.mimeType === "text/plain")
          .map((p) => p.data)
          .join("\n"),
        html: parts
          .filter((p) => p.mimeType === "text/html")
          .map((p) => p.data)
          .join("\n"),
      });
    }
    return out;
  }
}
