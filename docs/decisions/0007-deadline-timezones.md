# 0007 — Return deadlines keep the timezone they were confirmed in

Status: accepted

A return cutoff belongs to the purchase's local date, not to wherever the user is now. Changing the account timezone therefore does not move existing deadlines. Re-confirming a deadline in a new zone bumps its generation and reschedules (Section 22.2). Date-only reminders fire at 09:00 local; nonexistent local times move forward; ambiguous times use the earlier occurrence (tested around the 2026-11-01 America/Toronto fall-back).
