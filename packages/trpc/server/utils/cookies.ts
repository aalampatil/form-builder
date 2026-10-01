import type { IncomingHttpHeaders } from "node:http";

export function parseCookies(headers: IncomingHttpHeaders): Record<string, string> {
  const cookieHeader = headers.cookie;
  if (!cookieHeader) return {};

  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rest.join("=") ?? "");
  }
  return out;
}

