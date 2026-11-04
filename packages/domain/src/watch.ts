/**
 * Target-price watch state machine (Section 19). Pure: the caller provides the current
 * state, the evaluated best eligible total, the input generation and the clock.
 */
import { ceilDiv, Money } from "./money";

export type Lifecycle = "active" | "paused" | "deleted";
export type Qualification = "armed" | "satisfied" | "unknown";

export type WatchState = {
  lifecycle: Lifecycle;
  qualification: Qualification;
  /** Last non-unknown qualification; uncertainty must not create a new episode. */
  lastKnownQualification: "armed" | "satisfied";
  episode: number;
  rearmStreak: number;
  lastEvaluatedGeneration: bigint;
  ruleVersion: number;
};

export type WatchRule = { target: Money };

export type EvaluationInput = {
  /** Lowest eligible fresh known total for the watch's context; null when none/unknown. */
  bestEligibleTotal: Money | null;
  bestOfferId: string | null;
  generation: bigint;
};

export type WatchEvent = {
  kind: "price_target_met";
  /** "crossing" after a rearm; "already_qualifying" at creation/edit when opted in. */
  reason: "crossing" | "already_qualifying";
  episode: number;
  logicalKey: string;
};

export type EvaluationOutcome = {
  next: WatchState;
  event: WatchEvent | null;
  decision:
    | "skipped_stale_generation"
    | "skipped_inactive"
    | "unknown"
    | "qualified_new_episode"
    | "still_satisfied"
    | "rearm_progress"
    | "rearmed"
    | "rearm_reset"
    | "armed_not_qualifying";
};

/** Rearm margin = max(CAD 1.00, 2% of target), rounded up to a whole cent. */
export function rearmMargin(target: Money): Money {
  const pct = ceilDiv(target.amountMinor * 2n, 100n);
  return { amountMinor: pct > 100n ? pct : 100n, currency: target.currency };
}

export const REARM_REQUIRED_STREAK = 2;

export function watchEventKey(watchId: string, ruleVersion: number, episode: number): string {
  return `watch:${watchId}:v${ruleVersion}:episode:${episode}`;
}

export function evaluateWatch(watchId: string, state: WatchState, rule: WatchRule, input: EvaluationInput): EvaluationOutcome {
  if (state.lifecycle !== "active") return { next: state, event: null, decision: "skipped_inactive" };
  if (input.generation <= state.lastEvaluatedGeneration) {
    return { next: state, event: null, decision: "skipped_stale_generation" };
  }
  const base = { ...state, lastEvaluatedGeneration: input.generation };
  const best = input.bestEligibleTotal;

  if (!best || best.currency !== rule.target.currency) {
    // Unknown does not count toward rearm; MVP resets the streak (Section 19.3).
    return { next: { ...base, qualification: "unknown", rearmStreak: 0 }, event: null, decision: "unknown" };
  }

  const qualifies = best.amountMinor <= rule.target.amountMinor;
  if (qualifies) {
    if (state.lastKnownQualification === "armed") {
      const episode = state.episode + 1;
      return {
        next: { ...base, qualification: "satisfied", lastKnownQualification: "satisfied", episode, rearmStreak: 0 },
        event: { kind: "price_target_met", reason: "crossing", episode, logicalKey: watchEventKey(watchId, state.ruleVersion, episode) },
        decision: "qualified_new_episode",
      };
    }
    return {
      next: { ...base, qualification: "satisfied", lastKnownQualification: "satisfied", rearmStreak: 0 },
      event: null,
      decision: "still_satisfied",
    };
  }

  if (state.lastKnownQualification === "armed") {
    return { next: { ...base, qualification: "armed", rearmStreak: 0 }, event: null, decision: "armed_not_qualifying" };
  }

  // Satisfied (possibly via unknown) and not qualifying: hysteresis.
  const threshold = rule.target.amountMinor + rearmMargin(rule.target).amountMinor;
  if (best.amountMinor > threshold) {
    const streak = state.rearmStreak + 1;
    if (streak >= REARM_REQUIRED_STREAK) {
      return {
        next: { ...base, qualification: "armed", lastKnownQualification: "armed", rearmStreak: 0 },
        event: null,
        decision: "rearmed",
      };
    }
    return { next: { ...base, qualification: "satisfied", rearmStreak: streak }, event: null, decision: "rearm_progress" };
  }
  return { next: { ...base, qualification: "satisfied", rearmStreak: 0 }, event: null, decision: "rearm_reset" };
}

/**
 * Initial state at creation or after a rule edit (Section 19.2). If already qualifying the
 * watch starts satisfied; an event is produced only when the user opted in.
 */
export function initialWatchState(
  watchId: string,
  ruleVersion: number,
  rule: WatchRule,
  input: EvaluationInput,
  notifyIfAlreadyQualifying: boolean,
  previousEpisode = 0,
): { state: WatchState; event: WatchEvent | null } {
  const best = input.bestEligibleTotal;
  const known = best !== null && best.currency === rule.target.currency;
  const qualifies = known && best!.amountMinor <= rule.target.amountMinor;
  if (qualifies) {
    const episode = previousEpisode + 1;
    return {
      state: {
        lifecycle: "active",
        qualification: "satisfied",
        lastKnownQualification: "satisfied",
        episode,
        rearmStreak: 0,
        lastEvaluatedGeneration: input.generation,
        ruleVersion,
      },
      event: notifyIfAlreadyQualifying
        ? { kind: "price_target_met", reason: "already_qualifying", episode, logicalKey: watchEventKey(watchId, ruleVersion, episode) }
        : null,
    };
  }
  return {
    state: {
      lifecycle: "active",
      qualification: known ? "armed" : "unknown",
      lastKnownQualification: "armed",
      episode: previousEpisode,
      rearmStreak: 0,
      lastEvaluatedGeneration: input.generation,
      ruleVersion,
    },
    event: null,
  };
}

/** Email cooldown (Section 19.4): earliest instant the next price-alert email may be sent. */
export function emailNotBefore(lastAcceptedAt: Date | null, now: Date, cooldownHours: number): Date {
  if (!lastAcceptedAt || cooldownHours <= 0) return now;
  const t = lastAcceptedAt.getTime() + cooldownHours * 3600_000;
  return new Date(Math.max(t, now.getTime()));
}
