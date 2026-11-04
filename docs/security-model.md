# Security model

This records the tested boundaries and the known limits. It does not claim that the system is fully secure.

## Authentication
- Sign-in uses Better Auth 1.7.16 email magic links: 10-minute expiry, single use, tokens stored hashed (`storeToken: "hashed"`). Better Auth enforces a sign-in rate limit of 5 per 60 s per path.
- Sessions are HttpOnly cookies with the `buytrail` prefix. They are marked Secure whenever `APP_BASE_URL` is https. `trustedOrigins` is set to `APP_BASE_URL`.
- Post-sign-in redirects accept only same-site relative paths (`/sign-in?next=`).
- Sign-in links are never logged. Locally they arrive in Mailpit.

## Authorization
- Every private service function takes an `Actor` resolved on the server from the session and constrains the query by owner (`where: { id, userId }`). Ownership fields sent by the client are ignored.
- Other users' resources return **404**, never 403, so existence is not leaked (G21).
- The admin role comes only from `pnpm admin:grant <email>` (audited), or from `ADMIN_EMAILS` in non-live modes. `/admin` returns 404 to everyone else, and every admin service call runs `requireAdmin`.
- State-changing routes check the `Origin` header in addition to SameSite cookies.

Tested: `watches.int.test.ts` and `private.int.test.ts` (users A and B for watches, purchases, receipts, uploads, exports), and E2E "two-user isolation over HTTP".

## URLs (S10)
- `POST /api/product-links/resolve` never fetches. It accepts only https URLs on exact allowlisted hosts, rejects credentials and non-443 ports, and needs a recognized path. It then maps the link to a stored listing. Tested with `http://169.254.169.254/…` → 422.
- Outbound retailer links come from the source's allowed hosts. Feed imports reject rows with other hosts.
- No connector fetches arbitrary URLs. If a later connector has to, it needs the hardened fetch layer described in Section 25.2 (not built).

## Uploads (S11)
- Accepted types are PDF, JPEG and PNG. Limits: 10 MiB per file, 5 per purchase, 100 MiB per account (all configurable, with ceilings).
- The type comes from magic bytes, never from the extension or declared MIME. The declared type and size must match the bytes exactly.
- PDFs go through a structural scan that rejects JavaScript, launch actions, OpenAction/AA, embedded files, XFA, RichMedia, remote actions, and `#xx`-obfuscated names. This is a heuristic, **not malware scanning**.
- Images are decoded with sharp (`limitInputPixels` 40 MP, max dimension 12,000, single frame) and re-encoded into a metadata-stripped preview.
- Files stay in quarantine until validated. If validation fails they are rejected and deleted. If `RECEIPT_SCANNER=none` they stay `processing` and are never marked ready.
- Demo mode refuses all arbitrary uploads at the service layer, and config forbids enabling them in demo (G30).
- Downloads use `Content-Disposition: attachment`, `nosniff`, and `CSP: default-src 'none'; sandbox`.

## Data minimization and logging
- Logs are structured JSON. Keys matching email/token/password/secret/url/postal/destination/signed are redacted. Route errors log the message's first line only and return a generic envelope with a request ID.
- Public search queries only catalog tables and never joins private ones (tested). Search responses are `no-store`.
- A destination-specific quote context must have an owner (DB CHECK), and non-owners get 404.

## Deletion and export
- Deletion revokes all sessions, marks watches deleted, cancels unsent deliveries and reminders, and records a durable task. The worker then schedules deletion of every object (originals, previews, quarantine copies, exports), deletes the user row (cascade), and writes a SHA-256 tombstone.
- `reconcileTombstones` re-deletes accounts that reappear after a backup restore. Repeating a deletion is safe (G24).
- Exports are private ZIPs downloaded through an owner check and expire after 24 h.

## Known limitations
- The rate limiter is per process (ADR 0005).
- No CSP nonce: inline scripts are allowed for the Next.js bootstrap. No third-party scripts are loaded.
- The PDF scan is heuristic. Before enabling real uploads in live mode, add a real scanner such as ClamAV or a managed service behind `RECEIPT_SCANNER`.
- An accepted email cannot be recalled.
- Backups are not configured in this repository (see operations.md).
