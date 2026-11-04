"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "./client-api";
import { buttonPrimary, buttonSecondary, inputClass, Notice } from "./ui";

type W = { id: string; version: number; lifecycle: string; target: { amountMinor: string; display: string }; channels: string[] };

const toMinor = (s: string) => {
  const m = /^\s*(?:CAD\s*|\$)?(\d{1,10})(?:\.(\d{1,2}))?\s*$/.exec(s.replace(/,/g, ""));
  return m ? (BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0")).toString() : null;
};

export function WatchActions({ watch }: { watch: W }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // Preserve the entered value after a recoverable failure.
  const [target, setTarget] = useState((Number(watch.target.amountMinor) / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/watches/${watch.id}`, { method: "PATCH", json: { version: watch.version, ...body } });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.error.code === "VERSION_CONFLICT" ? `${e.message} (the list has been refreshed)` : e.message) : "Couldn't save.");
      if (e instanceof ApiFailure && e.error.code === "VERSION_CONFLICT") router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 sm:items-end">
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const m = toMinor(target);
            if (!m || m === "0") return setError("Enter a valid target, e.g. 195.00");
            void patch({ target: { amountMinor: m, currency: "CAD" } });
          }}
        >
          <label htmlFor={`t-${watch.id}`} className="sr-only">
            New target (CAD)
          </label>
          <input id={`t-${watch.id}`} value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className={`${inputClass} w-28`} />
          <button className={buttonPrimary} disabled={busy}>
            Save
          </button>
          <button type="button" className={buttonSecondary} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary} onClick={() => setEditing(true)} disabled={busy}>
            Edit target
          </button>
          <button type="button" className={buttonSecondary} disabled={busy} onClick={() => patch({ lifecycle: watch.lifecycle === "paused" ? "active" : "paused" })}>
            {watch.lifecycle === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className={buttonSecondary}
            disabled={busy}
            onClick={async () => {
              if (!confirm("Delete this watch? Pending alerts for it will be cancelled.")) return;
              setBusy(true);
              try {
                await api(`/api/watches/${watch.id}`, { method: "DELETE" });
                router.refresh();
              } catch (e) {
                setError(e instanceof ApiFailure ? e.message : "Couldn't delete.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete
          </button>
        </div>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}
