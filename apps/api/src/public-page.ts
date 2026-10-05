import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { get } from "node:https";

export function isPublicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Global unicast only, excluding mapped, transition, documentation and special ranges.
  return (
    version === 6 &&
    /^[23]/i.test(address) &&
    !/^(2001:|2002:|3fff:)/i.test(address)
  );
}
export function publicHttpsUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hostname === "localhost" ||
    /\.(local|localhost|internal)$/i.test(u.hostname)
  )
    throw new Error("Only public HTTPS company pages are supported");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host))
    throw new Error("Private network URLs are not allowed");
  return u;
}
export async function publicPage(
  value: string,
  allowedDomain: string,
  redirects = 0,
): Promise<{ body: string; finalUrl: string } | null> {
  const u = publicHttpsUrl(value);
  const host = u.hostname.replace(/^www\./, "");
  if (host !== allowedDomain && !host.endsWith("." + allowedDomain))
    return null;
  const answers = await lookup(u.hostname, { all: true });
  if (!answers.length || answers.some((a) => !isPublicAddress(a.address)))
    throw new Error("Company hostname resolves to a private network");
  const chosen = answers[0];
  const response = await new Promise<{
    status: number;
    location?: string;
    body: string;
    type: string;
  }>((resolve, reject) => {
    // Pin the validated DNS address on the actual request to prevent rebinding.
    const request = get(
      u,
      {
        headers: {
          "User-Agent": "JobAgent/0.1 (personal job search assistant)",
          Accept: "text/html,text/plain",
        },
        lookup: ((
          _host: string,
          options: { all?: boolean },
          callback: (...args: any[]) => void,
        ) =>
          options?.all
            ? callback(null, [chosen])
            : callback(null, chosen.address, chosen.family)) as any,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on("data", (chunk) => {
          size += chunk.length;
          if (size > 800_000) {
            request.destroy(new Error("Company page is too large"));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            location: incoming.headers.location,
            type: incoming.headers["content-type"] ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        incoming.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Company page timed out")),
      12_000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
  if (
    [301, 302, 303, 307, 308].includes(response.status) &&
    response.location &&
    redirects < 3
  )
    return publicPage(
      new URL(response.location, u).href,
      allowedDomain,
      redirects + 1,
    );
  if (
    response.status < 200 ||
    response.status >= 300 ||
    !/text\/(html|plain)/i.test(response.type)
  )
    return null;
  return { body: response.body, finalUrl: u.href };
}
