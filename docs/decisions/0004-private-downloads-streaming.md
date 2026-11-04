# 0004 — Receipt downloads via authenticated streaming, not signed URLs

Status: accepted

Signed URLs are bearer tokens that outlive revocation (Section 23). Receipts are small (≤10 MiB), so `GET /api/receipts/:id/download` checks ownership on every request and streams the object, with `Content-Disposition: attachment`, `nosniff` and `CSP: sandbox`. Uploads likewise go through `PUT /api/receipts/:id/content` rather than presigned PUTs, so object keys never reach the client and object-key substitution (G22) is impossible by construction. Cost: the bytes pass through the web process. This is acceptable at the pilot's scale.
