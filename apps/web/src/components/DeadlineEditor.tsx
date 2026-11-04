"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "./client-api";
import { buttonPrimary, buttonSecondary, inputClass, Notice, Badge } from "./ui";

type Deadline = {
  id: string;
  date: string;
  cutoffTime: string | null;
  timezone: string;
  source: string;
  confirmedAt: string;
  generation: number;
  reminders: Array<{ offsetDays: number; dueAt: string; localLabel: string; status: string }>;
} | null;

const ZONES = ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg", "America/Regina", "America/Edmonton", "America/Vancouver", "America/Whitehorse"];

export function DeadlineEditor({ itemId, deadline, defaultTimezone, disabled }: { itemId: string; deadline: Deadline; defaultTimezone: string; disabled: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(deadline?.date ?? "");
  const [time, setTime] = useState(deadline?.cutoffTime ?? "");
  const [tz, setTz] = useState(deadline?.timezone ?? defaultTimezone);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "good" | "warn"; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ skippedPastReminders: number }>(`/api/purchase-items/${itemId}/return-deadline`, {
        method: "PUT",
        json: { date, cutoffTime: time || null, timezone: tz, source: "user_entered", expectedGeneration: deadline?.generation ?? null },
      });
      setEditing(false);
      setMsg(r.skippedPastReminders ? { tone: "warn", text: `${r.skippedPastReminders} reminder time(s) had already passed and were skipped; only future reminders are scheduled.` } : { tone: "good", text: "Return date saved; reminders scheduled." });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof ApiFailure ? e.message : "Couldn't save." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 text-sm">
      {deadline && !editing ? (
        <div className="space-y-2" data-testid={`deadline-${itemId}`}>
          <p>
            <span className="text-muted">Return date:</span> <strong>{deadline.date}</strong>
            {deadline.cutoffTime && <> at {deadline.cutoffTime}</>} <span className="text-muted">({deadline.timezone})</span>{" "}
            <Badge tone="teal">{deadline.source === "user_entered" ? "Entered by you" : deadline.source === "user_confirmed_extraction" ? "Confirmed by you" : "Verified policy"}</Badge>
          </p>
          <p className="text-xs text-muted">This is your personal reminder date, not a guarantee that the retailer will accept a return.</p>
          <ul className="text-xs" aria-label="Scheduled reminders">
            {deadline.reminders.map((r) => (
              <li key={r.offsetDays} data-testid="reminder">
                {r.offsetDays} day{r.offsetDays === 1 ? "" : "s"} before: {r.localLabel} —{" "}
                {r.status === "scheduled" ? "scheduled" : r.status === "skipped_past" ? "skipped (time already passed)" : r.status}
              </li>
            ))}
          </ul>
          {!disabled && (
            <div className="flex gap-2">
              <button type="button" className={buttonSecondary} onClick={() => setEditing(true)}>
                Change date
              </button>
              <button
                type="button"
                className={buttonSecondary}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await api(`/api/purchase-items/${itemId}/return-deadline`, { method: "DELETE" }).catch(() => null);
                  router.refresh();
                  setBusy(false);
                }}
              >
                Remove date
              </button>
            </div>
          )}
        </div>
      ) : !editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted">Return date not set.</span>
          {!disabled && (
            <button type="button" className={buttonSecondary} onClick={() => setEditing(true)}>
              Set a return date
            </button>
          )}
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block">
            <span className="text-xs text-muted">Last day to return</span>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Cutoff time (optional)</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Timezone</span>
            <select value={tz} onChange={(e) => setTz(e.target.value)} className={`${inputClass} mt-1`}>
              {[...new Set([tz, ...ZONES])].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
          <button className={buttonPrimary} disabled={busy || !date}>
            {busy ? "Saving…" : "Confirm date"}
          </button>
          <button type="button" className={buttonSecondary} onClick={() => setEditing(false)}>
            Cancel
          </button>
          <p className="w-full text-xs text-muted">Reminders are sent at 09:00 local time 3 days and 1 day before (or before your cutoff time, if set).</p>
        </form>
      )}
      {msg && (
        <div className="mt-2">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
    </div>
  );
}
