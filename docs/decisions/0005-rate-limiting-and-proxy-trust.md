# 0005 — In-process rate limiting; forwarded headers trusted only by configuration

Status: accepted, with a known limitation

Search, sign-in (Better Auth's limiter), creates and uploads are rate-limited with fixed windows. Our own limiter lives in process memory, which is correct for one web instance. A multi-instance deployment must move it to Redis. `X-Forwarded-For` is client-controlled, so it is used for client identity only when `TRUST_PROXY=true` (set this behind a proxy that overwrites the header). Otherwise every client shares one bucket, which is conservative.
