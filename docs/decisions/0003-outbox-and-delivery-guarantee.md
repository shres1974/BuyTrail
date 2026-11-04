# 0003 — Transactional outbox; at-most-once email from BuyTrail's side

Status: accepted

Context: queue deduplication alone cannot protect the gap between commit and enqueue (Section 20.1), and SMTP gives no idempotency key (Section 21.1).

Decision:
- All work intent is an `outbox_event` row written in the business transaction. A relay publishes IDs to one BullMQ queue. A reconciler republishes undispatched, lost (dispatched but never claimed after 60 s) and lease-expired rows, using a fresh job ID each time. Handlers claim conditionally and are idempotent.
- Email delivery commits `sendStartedAt` before the SMTP call. If the outcome is ambiguous, we look the message up in the local mailbox; otherwise the delivery becomes `unknown_outcome` and is never resent automatically. The in-app event stays visible.

Consequences: an ambiguous send may mean the user gets no email for that event (they still see it in-app). We accept this over the risk of duplicate emails for the pilot. A provider with idempotency keys or a status API would allow safe retry; plug it into `Mailer.lookup`.
