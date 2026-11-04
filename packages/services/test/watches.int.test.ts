/**
 * M3/M5 integration: watches, durable events, concurrency, deliveries, outbox recovery.
 * Golden IDs G10–G19, G26–G28 and the Section 28.1 sequence against PostgreSQL.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_CONTEXT_ID } from "@buytrail/providers";
import {
  AppError,
  createWatch,
  deleteWatch,
  dispatchDelivery,
  evaluateOneWatch,
  evaluateWatchesFor,
  handleOutbox,
  listWatches,
  refreshListing,
  relayOutbox,
  seedDemoListings,
  simulateDemoPrice,
  sweepExpiredQuotes,
  updateWatch,
  getOwnedWatch,
  OUTBOX_LOST_AFTER_MS,
  demoProviders,
} from "../src";
import { DemoProvider as DP } from "@buytrail/providers";
import { drainOutbox, makeUser, seeded, type Kit } from "./kit";

let k: Kit;
const V = "var_demo_monitor_27_qhd"; // Cedar 205.00 free shipping is best (G01)
const cad = (s: string) => ({ amountMinor: s, currency: "CAD" as const });
const HOUR = 3600_000;

beforeEach(async () => {
  k = await seeded();
  await seedDemoListings(k.db, k.clock, { historyDays: 0 });
}, 60_000);

async function setCedar(minor: number) {
  return simulateDemoPrice(k.db, k.clock, "CE-310", BigInt(minor));
}
const events = (userId: string) => k.db.notificationEvent.findMany({ where: { userId, type: "price_target_met" }, orderBy: { createdAt: "asc" } });

describe("watch creation (Section 19.2)", () => {
  it("already qualifying: satisfied, offer shown, no surprise event", async () => {
    const u = await makeUser(k.db);
    const r = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("21000") }, null);
    expect(r.watch.qualification).toBe("satisfied");
    expect(r.alreadyQualifying).toBe(true);
    expect(r.dto.currentBest!.display).toBe("CAD 205.00");
    expect(await events(u.id)).toHaveLength(0);
  });
  it("already qualifying + opt-in: one 'An offer meets your target' event", async () => {
    const u = await makeUser(k.db);
    await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("21000"), notifyIfAlreadyQualifying: true, channels: ["in_app", "email"] }, null);
    const ev = await events(u.id);
    expect(ev).toHaveLength(1);
    expect((ev[0]!.payload as { headline: string }).headline).toBe("An offer meets your target");
  });
  it("rejects unknown variant, invalid targets and private contexts of other users", async () => {
    const u = await makeUser(k.db);
    const other = await makeUser(k.db);
    await expect(createWatch(k.db, k.config, k.clock.now(), u, { variantId: "nope", target: cad("100") }, null)).rejects.toThrow(AppError);
    await expect(createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("0") }, null)).rejects.toThrow(/greater than zero/);
    await expect(createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("19.50") }, null)).rejects.toThrow(/valid CAD/);
    await k.db.quoteContext.create({ data: { id: "ctx_private_other", market: "CA", destinationScope: "postal_prefix", destinationValue: "M5V", ownerUserId: other.id, description: "private" } });
    await expect(createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("100"), contextId: "ctx_private_other" }, null)).rejects.toThrow(/not found/);
  });
  it("G26: same idempotency key + same body → same watch; different body → conflict", async () => {
    const u = await makeUser(k.db);
    const a = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("19500") }, "idem-key-0001");
    const b = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("19500") }, "idem-key-0001");
    expect(b.watch.id).toBe(a.watch.id);
    await expect(createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("18000") }, "idem-key-0001")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await k.db.watch.count({ where: { userId: u.id } })).toBe(1);
  });
  it("enforces the active-watch limit", async () => {
    const u = await makeUser(k.db);
    const cfg = { ...k.config, MAX_ACTIVE_WATCHES_PER_USER: 2 };
    await createWatch(k.db, cfg, k.clock.now(), u, { variantId: V, target: cad("100") }, null);
    await createWatch(k.db, cfg, k.clock.now(), u, { variantId: V, target: cad("200") }, null);
    await expect(createWatch(k.db, cfg, k.clock.now(), u, { variantId: V, target: cad("300") }, null)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
});

describe("Section 28.1 deterministic sequence through the real pipeline", () => {
  it("episodes, hysteresis and one event per crossing", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000") }, null);
    expect(watch.qualification).toBe("armed");
    const step = async (minor: number) => {
      k.clock.advance(60_000);
      await setCedar(minor);
      await drainOutbox(k);
      return k.db.watch.findUniqueOrThrow({ where: { id: watch.id } });
    };
    // Other stores' totals are all above 102 for this variant? Cedar is the only one we move;
    // Pine (209.98) and others are higher, so Cedar determines the best eligible total.
    let w = await step(10000);
    expect([w.qualification, w.episode]).toEqual(["satisfied", 1]);
    w = await step(9900);
    expect([w.qualification, w.episode]).toEqual(["satisfied", 1]);
    w = await step(10200);
    expect([w.qualification, w.rearmStreak]).toEqual(["satisfied", 0]);
    w = await step(10300);
    expect([w.qualification, w.rearmStreak]).toEqual(["satisfied", 1]);
    w = await step(10400);
    expect([w.qualification, w.lastKnownQualification]).toEqual(["armed", "armed"]);
    w = await step(9800);
    expect([w.qualification, w.episode]).toEqual(["satisfied", 2]);
    const ev = await events(u.id);
    expect(ev.map((e) => e.logicalKey)).toEqual([`watch:${watch.id}:v1:episode:1`, `watch:${watch.id}:v1:episode:2`]);
    expect((ev[0]!.payload as { headline: string }).headline).toBe("Price dropped to your target");
  });
});

describe("evaluation safety", () => {
  it("G12: repeated processing of the same generation creates one event", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000") }, null);
    await setCedar(9900);
    for (let i = 0; i < 3; i++) await evaluateWatchesFor(k.db, k.config, k.clock.now(), V, DEMO_CONTEXT_ID);
    await drainOutbox(k);
    await evaluateOneWatch(k.db, k.config, k.clock.now(), watch.id);
    expect(await events(u.id)).toHaveLength(1);
  });
  it("G13: two concurrent evaluations of the same crossing → one episode, one event", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000") }, null);
    await setCedar(9900);
    await Promise.all(Array.from({ length: 6 }, () => evaluateOneWatch(k.db, k.config, k.clock.now(), watch.id)));
    const w = await k.db.watch.findUniqueOrThrow({ where: { id: watch.id } });
    expect(w.episode).toBe(1);
    expect(await events(u.id)).toHaveLength(1);
  });
  it("G11: a stale offer below target does not alert", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000") }, null);
    await setCedar(9900);
    // Let it go stale before the watch is evaluated.
    k.clock.advance(7 * HOUR);
    await sweepExpiredQuotes(k.db, k.clock);
    await drainOutbox(k);
    await evaluateOneWatch(k.db, k.config, k.clock.now(), watch.id);
    const w = await k.db.watch.findUniqueOrThrow({ where: { id: watch.id } });
    expect(w.qualification).toBe("unknown");
    expect(await events(u.id)).toHaveLength(0);
  });
  it("G28: when all comparable offers disappear → unknown, not zero, not a rearm", async () => {
    const u = await makeUser(k.db);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("21000") }, null);
    expect(watch.qualification).toBe("satisfied");
    k.clock.advance(7 * HOUR);
    await sweepExpiredQuotes(k.db, k.clock);
    await drainOutbox(k);
    const w = await k.db.watch.findUniqueOrThrow({ where: { id: watch.id } });
    expect([w.qualification, w.lastKnownQualification, w.rearmStreak, w.lastBestTotalMinor]).toEqual(["unknown", "satisfied", 0, null]);
    const dto = (await listWatches(k.db, k.clock.now(), u))[0]!;
    expect(dto.currentBest).toBeNull();
    expect(dto.status).toMatch(/No eligible offer/);
  });
  it("G16: a 90% drop is pending verification and cannot alert until independently confirmed", async () => {
    const u = await makeUser(k.db);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("5000") }, null);
    await setCedar(2050); // 90% drop
    const q = await k.db.offerQuote.findFirstOrThrow({ where: { listing: { externalListingId: "CE-310" } } });
    expect(q.anomalyStatus).toBe("pending_verification");
    await evaluateOneWatch(k.db, k.config, k.clock.now(), watch.id);
    expect(await events(u.id)).toHaveLength(0);
    // The verification job (a new source check) reproduces the price → confirmed → alert.
    k.clock.advance(10_000);
    const r = await drainOutbox(k);
    expect(r.some((x) => x.startsWith("refresh.listing:accepted"))).toBe(true);
    const q2 = await k.db.offerQuote.findFirstOrThrow({ where: { listing: { externalListingId: "CE-310" } } });
    expect(q2.anomalyStatus).toBe("confirmed");
    expect(await events(u.id)).toHaveLength(1);
  });
});

describe("ingestion ordering and failures", () => {
  it("G14: an older refresh completing after a newer one does not overwrite current state", async () => {
    const listing = await k.db.sourceListing.findFirstOrThrow({ where: { externalListingId: "CE-310" } });
    const { claimRefresh, acceptObservation } = await import("../src");
    const provider = k.providers.get(listing.sourceId)!;
    const lookup = () => provider.lookup({ externalListingId: "CE-310", externalVariantKey: "", sellerKey: listing.sellerKey, contextKey: "ca-national" });
    const older = await claimRefresh(k.db, k.clock, listing.id, DEMO_CONTEXT_ID, "a");
    const olderObs = { ...(await lookup()), itemPrice: cad("15000") };
    const newer = await claimRefresh(k.db, k.clock, listing.id, DEMO_CONTEXT_ID, "b");
    const newerObs = { ...(await lookup()), itemPrice: cad("20000") };
    expect(newer!.generation).toBeGreaterThan(older!.generation);
    await acceptObservation(k.db, k.clock, newer!, newerObs);
    const r = await acceptObservation(k.db, k.clock, older!, olderObs);
    expect(r).toMatchObject({ applied: false, superseded: true });
    const q = await k.db.offerQuote.findFirstOrThrow({ where: { listingId: listing.id } });
    expect(q.itemPriceMinor).toBe(20000n);
    expect(q.generation).toBe(newer!.generation);
    // The old observation is kept as history but flagged.
    expect(await k.db.priceObservation.count({ where: { listingId: listing.id, supersededByNewer: true } })).toBe(1);
  });
  it("G10: provider timeout preserves the last valid state and records a check failure", async () => {
    const listing = await k.db.sourceListing.findFirstOrThrow({ where: { externalListingId: "CE-310" } });
    const before = await k.db.offerQuote.findFirstOrThrow({ where: { listingId: listing.id } });
    const providers = new Map([[listing.sourceId, new DP({ sourceId: listing.sourceId, clock: k.clock, fault: () => ({ kind: "timeout", delayMs: 500 }) })]]);
    const r = await refreshListing(k.db, k.clock, providers, listing.id, DEMO_CONTEXT_ID, { timeoutMs: 50 });
    expect(r).toMatchObject({ kind: "failed", code: "timeout" });
    const after = await k.db.offerQuote.findFirstOrThrow({ where: { listingId: listing.id } });
    expect([after.itemPriceMinor, after.stock, after.generation]).toEqual([before.itemPriceMinor, before.stock, before.generation]);
    expect(after.lastCheckFailure).toBe("timeout");
    expect(after.lastCheckFailedAt).not.toBeNull();
  });
  it("G15: 429 Retry-After is persisted and respected; the request budget is enforced", async () => {
    const listing = await k.db.sourceListing.findFirstOrThrow({ where: { externalListingId: "CE-310" } });
    const limited = new Map([[listing.sourceId, new DP({ sourceId: listing.sourceId, clock: k.clock, fault: () => ({ kind: "rate_limited", retryAfterMs: 120_000 }) })]]);
    const r1 = await refreshListing(k.db, k.clock, limited, listing.id, DEMO_CONTEXT_ID);
    expect(r1).toMatchObject({ kind: "failed", code: "quota_exhausted" });
    // A fresh process (healthy provider) still waits: the delay lives in PostgreSQL.
    const r2 = await refreshListing(k.db, k.clock, demoProviders(k.clock, k.db), listing.id, DEMO_CONTEXT_ID);
    expect(r2).toMatchObject({ kind: "skipped", reason: "rate_limited" });
    k.clock.advance(121_000);
    expect((await refreshListing(k.db, k.clock, demoProviders(k.clock, k.db), listing.id, DEMO_CONTEXT_ID)).kind).toBe("accepted");
    // Budget: cap at the current usage → next request is refused without calling the provider.
    const used = (await k.db.sourceBudgetDay.findFirstOrThrow({ where: { sourceId: listing.sourceId } })).used;
    await k.db.source.update({ where: { id: listing.sourceId }, data: { dailyRequestBudget: used } });
    expect(await refreshListing(k.db, k.clock, demoProviders(k.clock, k.db), listing.id, DEMO_CONTEXT_ID)).toMatchObject({ kind: "skipped", reason: "budget_exhausted" });
  });
  it("malformed provider data is rejected as invalid_response, state unchanged", async () => {
    const listing = await k.db.sourceListing.findFirstOrThrow({ where: { externalListingId: "CE-310" } });
    const bad = new Map([[listing.sourceId, new DP({ sourceId: listing.sourceId, clock: k.clock, fault: () => ({ kind: "malformed" }) })]]);
    const r = await refreshListing(k.db, k.clock, bad, listing.id, DEMO_CONTEXT_ID);
    expect(r).toMatchObject({ kind: "failed", code: "invalid_response" });
    expect((await k.db.offerQuote.findFirstOrThrow({ where: { listingId: listing.id } })).itemPriceMinor).toBe(20500n);
  });
});

describe("edits, pause, delete (G19, G27)", () => {
  it("G27: two tabs editing the same version → one wins, other gets VERSION_CONFLICT with current state", async () => {
    const u = await makeUser(k.db);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("19000") }, null);
    const results = await Promise.allSettled([
      updateWatch(k.db, k.config, k.clock.now(), u, watch.id, { version: 1, target: cad("18000") }),
      updateWatch(k.db, k.config, k.clock.now(), u, watch.id, { version: 1, target: cad("17000") }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rej = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rej.reason).toMatchObject({ code: "VERSION_CONFLICT" });
    expect((rej.reason as AppError).extra.current).toBeTruthy();
  });
  it("editing the target increments the rule version and cancels old-version deliveries", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000"), channels: ["in_app", "email"] }, null);
    await setCedar(9900);
    await evaluateOneWatch(k.db, k.config, k.clock.now(), watch.id);
    const updated = await updateWatch(k.db, k.config, k.clock.now(), u, watch.id, { version: 1, target: cad("9000") });
    expect(updated.ruleVersion).toBe(2);
    const d = await k.db.notificationDelivery.findFirstOrThrow({ where: { event: { watchId: watch.id } } });
    expect([d.state, d.suppressedReason]).toEqual(["cancelled", "rule_version_superseded"]);
  });
  it("G19: pausing before dispatch suppresses the pending email", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000"), channels: ["in_app", "email"] }, null);
    await setCedar(9900);
    await evaluateOneWatch(k.db, k.config, k.clock.now(), watch.id);
    const w = await getOwnedWatch(k.db, u, watch.id);
    await updateWatch(k.db, k.config, k.clock.now(), u, watch.id, { version: w.version, lifecycle: "paused" });
    await drainOutbox(k);
    expect(k.mailer.sent).toHaveLength(0);
    expect((await k.db.notificationDelivery.findFirstOrThrow({ where: { event: { watchId: watch.id } } })).state).toBe("cancelled");
    // Event still visible in-app.
    expect(await events(u.id)).toHaveLength(1);
  });
  it("pause racing with a claimed delivery: revalidation before send suppresses it", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000"), channels: ["in_app", "email"] }, null);
    await setCedar(9900);
    await evaluateOneWatch(k.db, k.config, k.clock.now(), watch.id);
    // Pause directly (bypassing cancellation) to simulate the race after claim.
    await k.db.watch.update({ where: { id: watch.id }, data: { lifecycle: "paused" } });
    const d = await k.db.notificationDelivery.findFirstOrThrow({ where: { event: { watchId: watch.id } } });
    expect(await dispatchDelivery(k.db, k.config, k.clock, k.mailer, d.id)).toBe("suppressed");
    expect(k.mailer.sent).toHaveLength(0);
  });
  it("delete cancels pending work and hides the watch", async () => {
    const u = await makeUser(k.db);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("21000"), notifyIfAlreadyQualifying: true, channels: ["in_app", "email"] }, null);
    await deleteWatch(k.db, u, watch.id);
    await drainOutbox(k);
    expect(k.mailer.sent).toHaveLength(0);
    expect(await listWatches(k.db, k.clock.now(), u)).toHaveLength(0);
  });
});

describe("email delivery (Section 21)", () => {
  async function crossing(u: Awaited<ReturnType<typeof makeUser>>, channels = ["in_app", "email"]) {
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000"), channels }, null);
    await setCedar(9900);
    await drainOutbox(k);
    return watch;
  }
  it("delivers once with exact variant, total, target, tax note and preference links", async () => {
    const u = await makeUser(k.db);
    await crossing(u);
    expect(k.mailer.sent).toHaveLength(1);
    const m = k.mailer.sent[0]!;
    expect(m.subject).toMatch(/Sample data/);
    expect(m.text).toContain("Clearpeak CP27Q 27-inch QHD monitor — 27 in, QHD, 75 Hz");
    expect(m.text).toContain("CAD 99.00");
    expect(m.text).toContain("your target: CAD 100.00");
    expect(m.text).toMatch(/Tax is not included/);
    expect(m.text).toContain("/settings");
    await drainOutbox(k);
    expect(k.mailer.sent).toHaveLength(1);
  });
  it("in-app event persists even when email fails permanently", async () => {
    const u = await makeUser(k.db);
    k.mailer.next.push("permanent");
    await crossing(u);
    expect(await events(u.id)).toHaveLength(1);
    expect((await k.db.notificationDelivery.findFirstOrThrow({ where: { event: { userId: u.id } } })).state).toBe("permanent_failure");
  });
  it("definite non-send (connection refused) is retried with backoff", async () => {
    const u = await makeUser(k.db);
    k.mailer.next.push("refused");
    await crossing(u);
    const d = await k.db.notificationDelivery.findFirstOrThrow({ where: { event: { userId: u.id } } });
    expect(d.state).toBe("retryable_failure");
    k.clock.advance(2 * HOUR);
    await drainOutbox(k);
    expect((await k.db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).state).toBe("accepted");
    expect(k.mailer.sent).toHaveLength(1);
  });
  it("G18: ambiguous result is never blindly resent", async () => {
    const u = await makeUser(k.db);
    k.mailer.next.push("ambiguous");
    await crossing(u);
    const d = await k.db.notificationDelivery.findFirstOrThrow({ where: { event: { userId: u.id } } });
    expect(d.state).toBe("unknown_outcome");
    k.clock.advance(2 * HOUR);
    await drainOutbox(k);
    expect(k.mailer.sent).toHaveLength(1);
  });
  it("G18: worker crash after the send started → lease expiry → unknown_outcome, no resend", async () => {
    const u = await makeUser(k.db);
    k.mailer.next.push("crash_after_accept");
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000"), channels: ["in_app", "email"] }, null);
    await setCedar(9900);
    const d = await (async () => {
      await drainOutbox(k).catch(() => []);
      return k.db.notificationDelivery.findFirstOrThrow({ where: { event: { watchId: watch.id } } });
    })();
    // Simulate a crash: the delivery row is left claimed with sendStartedAt set.
    await k.db.notificationDelivery.update({ where: { id: d.id }, data: { state: "claimed", sendStartedAt: k.clock.now(), leaseExpiresAt: new Date(k.clock.now().getTime() + 1000) } });
    k.clock.advance(5 * 60_000);
    expect(await dispatchDelivery(k.db, k.config, k.clock, k.mailer, d.id)).toBe("unknown_outcome");
    expect(k.mailer.sent).toHaveLength(1);
  });
  it("cooldown: a second episode within 24h appears in-app; email waits, then revalidates", async () => {
    const u = await makeUser(k.db);
    const watch = await crossing(u);
    expect(k.mailer.sent).toHaveLength(1);
    // Rearm (two evaluations above 102) and cross again 1 hour later.
    for (const p of [10500, 10600]) {
      k.clock.advance(10 * 60_000);
      await setCedar(p);
      await drainOutbox(k);
    }
    k.clock.advance(10 * 60_000);
    await setCedar(9800);
    await drainOutbox(k);
    expect(await events(u.id)).toHaveLength(2);
    expect(k.mailer.sent).toHaveLength(1);
    const d2 = await k.db.notificationDelivery.findFirstOrThrow({ where: { event: { watchId: watch.id, logicalKey: { endsWith: "episode:2" } } } });
    expect(d2.notBefore.getTime()).toBeGreaterThan(k.clock.now().getTime() + 20 * HOUR);
    // Before the cooldown ends the price rises above target → suppressed at send time.
    k.clock.advance(5 * 60_000);
    await setCedar(11000);
    k.clock.advance(24 * HOUR);
    // Refresh everything that went stale meanwhile, so the comparison reflects current prices.
    await setCedar(11000);
    await drainOutbox(k);
    const d2b = await k.db.notificationDelivery.findUniqueOrThrow({ where: { id: d2.id } });
    expect(d2b.state).toBe("suppressed");
    expect(["no_longer_meets_target", "no_longer_eligible"]).toContain(d2b.suppressedReason);
    expect(k.mailer.sent).toHaveLength(1);
  });
  it("cooldown: after 24h a still-qualifying deferred email is sent", async () => {
    const u = await makeUser(k.db);
    const watch = await crossing(u);
    for (const p of [10500, 10600]) {
      k.clock.advance(10 * 60_000);
      await setCedar(p);
      await drainOutbox(k);
    }
    k.clock.advance(10 * 60_000);
    await setCedar(9800);
    await drainOutbox(k);
    expect(k.mailer.sent).toHaveLength(1);
    k.clock.advance(24 * HOUR);
    await setCedar(9800); // fresh check, still qualifying
    await drainOutbox(k);
    expect(k.mailer.sent).toHaveLength(2);
    expect(k.mailer.sent[1]!.text).toContain("CAD 98.00");
    void watch;
  });
  it("email preferences are rechecked at send time", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000"), channels: ["in_app", "email"] }, null);
    await setCedar(9900);
    await evaluateOneWatch(k.db, k.config, k.clock.now(), watch.id); // delivery queued
    await k.db.user.update({ where: { id: u.id }, data: { emailAlerts: false } }); // opt out before send
    await drainOutbox(k);
    expect(k.mailer.sent).toHaveLength(0);
    expect((await k.db.notificationDelivery.findFirstOrThrow({ where: { event: { userId: u.id } } })).suppressedReason).toBe("email_preference_off");
  });
  it("email opt-out at event time creates no email delivery; in-app event still exists", async () => {
    const u = await makeUser(k.db);
    await k.db.user.update({ where: { id: u.id }, data: { emailAlerts: false } });
    await crossing(u);
    expect(await events(u.id)).toHaveLength(1);
    expect(await k.db.notificationDelivery.count({ where: { event: { userId: u.id } } })).toBe(0);
  });
});

describe("outbox durability (G17)", () => {
  it("queue cleared after dispatch: reconciler republishes unfinished work", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000") }, null);
    await setCedar(9900);
    const published: string[] = [];
    const r1 = await relayOutbox(k.db, k.clock, async (j) => void published.push(j.outboxId));
    expect(r1.published).toBeGreaterThan(0);
    // "Redis is flushed": nothing consumes these jobs. After the loss window the relay republishes.
    const r2 = await relayOutbox(k.db, k.clock, async () => {});
    expect(r2.published + r2.reconciled).toBe(0);
    k.clock.advance(OUTBOX_LOST_AFTER_MS + 1000);
    const again: string[] = [];
    const r3 = await relayOutbox(k.db, k.clock, async (j) => void again.push(j.outboxId));
    expect(r3.reconciled).toBe(published.length);
    expect(new Set(again)).toEqual(new Set(published));
    for (const id of again) await handleOutbox(k, id);
    expect(await events(u.id)).toHaveLength(1);
  });
  it("expired worker lease is recovered; duplicate handling is a no-op", async () => {
    const u = await makeUser(k.db);
    await setCedar(11000);
    await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: cad("10000") }, null);
    await setCedar(9900);
    const row = await k.db.outboxEvent.findFirstOrThrow({ where: { type: "watch.evaluate_variant", completedAt: null } });
    // Worker A claims and dies.
    const { claimOutbox } = await import("../src");
    expect(await claimOutbox(k.db, k.clock, row.id)).not.toBeNull();
    expect(await handleOutbox(k, row.id)).toBe("not_claimed"); // lease held
    k.clock.advance(3 * 60_000);
    const pub: string[] = [];
    await relayOutbox(k.db, k.clock, async (j) => void pub.push(j.outboxId));
    expect(pub).toContain(row.id);
    expect(await handleOutbox(k, row.id)).toMatch(/evaluated/);
    expect(await handleOutbox(k, row.id)).toBe("not_claimed");
    expect(await events(u.id)).toHaveLength(1);
  });
});

describe("two-user isolation (watches)", () => {
  it("user B cannot read, edit or delete user A's watch", async () => {
    const a = await makeUser(k.db);
    const b = await makeUser(k.db);
    const { watch } = await createWatch(k.db, k.config, k.clock.now(), a, { variantId: V, target: cad("19000") }, null);
    await expect(getOwnedWatch(k.db, b, watch.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateWatch(k.db, k.config, k.clock.now(), b, watch.id, { version: 1, target: cad("1000") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteWatch(k.db, b, watch.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listWatches(k.db, k.clock.now(), b)).toHaveLength(0);
    // Idempotency keys are scoped per user.
    await createWatch(k.db, k.config, k.clock.now(), a, { variantId: V, target: cad("100") }, "shared-key-01");
    await createWatch(k.db, k.config, k.clock.now(), b, { variantId: V, target: cad("200") }, "shared-key-01");
    expect(await k.db.watch.count({ where: { userId: b.id } })).toBe(1);
  });
});

