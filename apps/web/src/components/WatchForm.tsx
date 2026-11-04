"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiFailure, newIdempotencyKey } from "./client-api";
import { buttonPrimary, inputClass, labelClass, Notice } from "./ui";

type MoneyDTO = { amountMinor: string; currency: string; display: string };

function toMinor(s: string): string | null {
  const m = /^\s*(?:CAD\s*|\$)?(\d{1,10})(?:\.(\d{1,2}))?\s*$/.exec(s.replace(/,/g, ""));
  if (!m) return null;
  return (BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0")).toString();
}

export function WatchForm({
  variantId,
  variantTitle,
  condition,
  contextId,
  currentBest,
}: {
  variantId: string;
  variantTitle: string;
  condition: string;
  contextId: string;
  currentBest: MoneyDTO | null;
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [email, setEmail] = useState(true);
  const [notifyNow, setNotifyNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields?: Record<string, string> } | null>(null);
  const [done, setDone] = useState<{ id: string; alreadyQualifying: boolean } | null>(null);
  // Stable per form fill: a retried submit reuses the key (no duplicate watch).
  const idemKey = useMemo(() => newIdempotencyKey("watch"), [variantId, target, email, notifyNow]); // eslint-disable-line react-hooks/exhaustive-deps

  const minor = toMinor(target);
  const qualifiesNow = minor !== null && currentBest !== null && BigInt(currentBest.amountMinor) <= BigInt(minor);

  if (done) {
    return (
      <div className="mt-3 space-y-2">
        <Notice tone="good" title="Watch saved">
          {done.alreadyQualifying
            ? notifyNow
              ? "An offer already meets your target — we've added it to your alerts."
              : "An offer already meets your target (shown above). We won't send a “price drop” email for it; you'll be alerted when the price rises and comes back down."
            : "We'll alert you when the lowest eligible known total reaches your target."}
        </Notice>
        <Link href="/watchlist" className="text-sm font-medium text-teal underline">
          Go to your watchlist
        </Link>
      </div>
    );
  }

  return (
    <form
      className="mt-3 space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!minor || minor === "0") {
          setError({ message: "Enter a target amount greater than zero, like 195.00.", fields: { target: "Required" } });
          return;
        }
        setBusy(true);
        try {
          const r = await api<{ watch: { id: string }; alreadyQualifying: boolean }>("/api/watches", {
            method: "POST",
            idempotencyKey: idemKey,
            json: { variantId, condition, contextId, target: { amountMinor: minor, currency: "CAD" }, channels: email ? ["in_app", "email"] : ["in_app"], notifyIfAlreadyQualifying: notifyNow },
          });
          setDone({ id: r.watch.id, alreadyQualifying: r.alreadyQualifying });
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiFailure ? { message: err.message, fields: err.error.fields } : { message: "Couldn't save the watch." });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm">
        <span className="text-muted">Item:</span> <strong>{variantTitle}</strong>
        <br />
        <span className="text-muted">Condition:</span> {condition} · <span className="text-muted">Context:</span> Canada, national shipping, qty 1
      </p>
      <div>
        <label htmlFor="watch-target" className={labelClass}>
          Target known total before tax (CAD)
        </label>
        <input
          id="watch-target"
          inputMode="decimal"
          autoComplete="off"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="195.00"
          aria-invalid={!!error?.fields?.target}
          aria-describedby="watch-target-help"
          className={`${inputClass} mt-1 max-w-[12rem]`}
        />
        <p id="watch-target-help" className="mt-1 text-xs text-muted">
          Compared against item price + known shipping + known fees, before tax. Offers with unknown shipping, stale prices or a different condition never trigger
          an alert.
        </p>
        {qualifiesNow && (
          <p className="mt-2 text-sm text-teal-dark" role="status">
            An eligible offer already meets this target ({currentBest!.display}).
          </p>
        )}
      </div>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">Notifications</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked disabled /> In-app alert (always on)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email (at most one price email per watch per 24 hours)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={notifyNow} onChange={(e) => setNotifyNow(e.target.checked)} /> Also notify me about offers that already meet the target
        </label>
      </fieldset>
      {error && <Notice tone="bad">{error.message}</Notice>}
      <button type="submit" disabled={busy} className={buttonPrimary}>
        {busy ? "Saving…" : "Save watch"}
      </button>
    </form>
  );
}
