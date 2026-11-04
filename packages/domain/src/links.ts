/**
 * Product-link parsing and outbound-link validation (Sections 18, 25.2). This never fetches a
 * URL. It only recognizes supported hosts and extracts identifiers for an approved lookup.
 */

export type LinkRule = {
  sourceId: string;
  hosts: string[];
  /** Regex over the URL pathname capturing the external listing ID in group 1. */
  pathPattern: RegExp;
};

export type ParsedLink =
  | { ok: true; sourceId: string; externalListingId: string }
  | { ok: false; reason: "invalid_url" | "unsupported_scheme" | "unsupported_host" | "unrecognized_path" | "credentials_in_url" | "nonstandard_port" };

export function parseProductLink(raw: string, rules: LinkRule[]): ParsedLink {
  let u: URL;
  if (raw.length > 2048) return { ok: false, reason: "invalid_url" };
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "unsupported_scheme" };
  if (u.username || u.password) return { ok: false, reason: "credentials_in_url" };
  if (u.port && u.port !== "443") return { ok: false, reason: "nonstandard_port" };
  const host = u.hostname.toLowerCase();
  const rule = rules.find((r) => r.hosts.includes(host)); // exact host match only
  if (!rule) return { ok: false, reason: "unsupported_host" };
  const m = rule.pathPattern.exec(u.pathname);
  if (!m?.[1]) return { ok: false, reason: "unrecognized_path" };
  return { ok: true, sourceId: rule.sourceId, externalListingId: m[1] };
}

/** Outbound retailer link must be https on an allowed host for its source. */
export function isAllowedOutboundUrl(raw: string, allowedHosts: string[]): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && allowedHosts.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}
