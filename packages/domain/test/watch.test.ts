import { describe, expect, it } from "vitest";
import { emailNotBefore, evaluateWatch, initialWatchState, money, rearmMargin, WatchState } from "../src";

const cad = (major: number) => money(BigInt(Math.round(major * 100)));
const rule = { target: cad(100) };

function run(totals: Array<number | null>, start?: WatchState) {
  let state: WatchState =
    start ?? { lifecycle: "active", qualification: "armed", lastKnownQualification: "armed", episode: 0, rearmStreak: 0, lastEvaluatedGeneration: 0n, ruleVersion: 1 };
  const log: Array<{ total: number | null; q: string; streak: number; episode: number; event: string | null; decision: string }> = [];
  let gen = 0n;
  for (const t of totals) {
    gen++;
    const out = evaluateWatch("w1", state, rule, { bestEligibleTotal: t === null ? null : cad(t), bestOfferId: "o", generation: gen });
    state = out.next;
    log.push({ total: t, q: state.lastKnownQualification, streak: state.rearmStreak, episode: state.episode, event: out.event?.logicalKey ?? null, decision: out.decision });
  }
  return { state, log };
}

describe("R11 rearm margin", () => {
  it("max(CAD 1.00, 2% of target) rounded up to a cent", () => {
    expect(rearmMargin(cad(100)).amountMinor).toBe(200n);
    expect(rearmMargin(cad(20)).amountMinor).toBe(100n);
    expect(rearmMargin(money(5001n * 10n)).amountMinor).toBe(1001n); // 2% of 500.10 = 10.002 → 10.01
  });
});

describe("Section 28.1 deterministic watch sequence", () => {
  it("matches the specified table", () => {
    const { log } = run([110, 100, 99, 102, 103, 104, 98]);
    expect(log.map((l) => [l.q, l.episode, l.event])).toEqual([
      ["armed", 0, null],
      ["satisfied", 1, "watch:w1:v1:episode:1"],
      ["satisfied", 1, null],
      ["satisfied", 1, null], // 102.00 is not strictly greater than 102.00
      ["satisfied", 1, null], // streak 1
      ["armed", 1, null], // rearmed
      ["satisfied", 2, "watch:w1:v1:episode:2"],
    ]);
    expect(log[4]!.streak).toBe(1);
    expect(log[5]!.decision).toBe("rearmed");
  });
  it("an unknown evaluation between steps 5 and 6 resets the streak", () => {
    const { log } = run([110, 100, 99, 102, 103, null, 104, 105]);
    expect(log[5]!.decision).toBe("unknown");
    expect(log[5]!.streak).toBe(0);
    expect(log[6]!.decision).toBe("rearm_progress"); // step 6 is now the first usable rearm observation
    expect(log[7]!.decision).toBe("rearmed");
  });
  it("unknown does not create a new episode (G28: offers disappear)", () => {
    const { log } = run([110, 100, null, null, 99]);
    expect(log.filter((l) => l.event).length).toBe(1);
    expect(log[4]!.decision).toBe("still_satisfied");
  });
  it("G12: repeated processing of the same generation is a no-op", () => {
    const s0: WatchState = { lifecycle: "active", qualification: "armed", lastKnownQualification: "armed", episode: 0, rearmStreak: 0, lastEvaluatedGeneration: 0n, ruleVersion: 1 };
    const a = evaluateWatch("w1", s0, rule, { bestEligibleTotal: cad(90), bestOfferId: "o", generation: 5n });
    expect(a.event).not.toBeNull();
    const b = evaluateWatch("w1", a.next, rule, { bestEligibleTotal: cad(90), bestOfferId: "o", generation: 5n });
    expect(b.decision).toBe("skipped_stale_generation");
    expect(b.event).toBeNull();
    const older = evaluateWatch("w1", a.next, rule, { bestEligibleTotal: cad(200), bestOfferId: "o", generation: 4n });
    expect(older.decision).toBe("skipped_stale_generation");
  });
  it("paused watches are not evaluated", () => {
    const s: WatchState = { lifecycle: "paused", qualification: "armed", lastKnownQualification: "armed", episode: 0, rearmStreak: 0, lastEvaluatedGeneration: 0n, ruleVersion: 1 };
    expect(evaluateWatch("w1", s, rule, { bestEligibleTotal: cad(1), bestOfferId: "o", generation: 1n }).decision).toBe("skipped_inactive");
  });
});

describe("initial state (Section 19.2)", () => {
  it("already qualifying: satisfied, no event unless opted in", () => {
    const a = initialWatchState("w", 1, rule, { bestEligibleTotal: cad(95), bestOfferId: "o", generation: 3n }, false);
    expect(a.state.qualification).toBe("satisfied");
    expect(a.event).toBeNull();
    const b = initialWatchState("w", 1, rule, { bestEligibleTotal: cad(95), bestOfferId: "o", generation: 3n }, true);
    expect(b.event).toMatchObject({ reason: "already_qualifying", logicalKey: "watch:w:v1:episode:1" });
  });
  it("no eligible offer: unknown qualification, armed baseline", () => {
    const a = initialWatchState("w", 1, rule, { bestEligibleTotal: null, bestOfferId: null, generation: 0n }, true);
    expect(a.state).toMatchObject({ qualification: "unknown", lastKnownQualification: "armed" });
    expect(a.event).toBeNull();
  });
  it("edit (new rule version) continues episode numbering with new key", () => {
    const a = initialWatchState("w", 2, rule, { bestEligibleTotal: cad(95), bestOfferId: "o", generation: 3n }, true, 4);
    expect(a.event?.logicalKey).toBe("watch:w:v2:episode:5");
  });
});

describe("cooldown", () => {
  it("delays email until 24h after the last accepted email", () => {
    const last = new Date("2026-11-01T10:00:00Z");
    expect(emailNotBefore(last, new Date("2026-11-01T20:00:00Z"), 24).toISOString()).toBe("2026-11-02T10:00:00.000Z");
    expect(emailNotBefore(last, new Date("2026-11-03T00:00:00Z"), 24).toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect(emailNotBefore(null, new Date("2026-11-03T00:00:00Z"), 24).toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });
});
