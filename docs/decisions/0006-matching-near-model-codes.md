# 0006 — Near model codes produce review candidates

Status: accepted

Golden fixture G04 ("CP27QX" next to the known "CP27Q") used to come out `unmatched`, so it never reached the review queue. Rule `match-v1` now also produces a `candidate` when the listing's normalized model is a prefix-extension of a known model (or the reverse) for the same brand. Candidates never auto-link. Benchmark (`pnpm match:benchmark`): 373 labelled synthetic cases, 0 false automatic merges, 0 missed matches. This holds for the synthetic set only, not universally.
