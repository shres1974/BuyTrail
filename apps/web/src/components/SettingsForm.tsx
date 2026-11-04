"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "./client-api";
import { buttonPrimary, inputClass, labelClass, Notice } from "./ui";

type S = { version: number; timezone: string; emailAlerts: boolean; emailReminders: boolean; categoryEmailOptOut: string[] };

const ZONES = ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg", "America/Regina", "America/Edmonton", "America/Vancouver", "America/Whitehorse"];

export function SettingsForm({ settings, categories }: { settings: S; categories: Array<{ key: string; label: string }> }) {
  const router = useRouter();
  const [v, setV] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  return (
    <form
      className="mt-3 space-y-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          const r = await api<S>("/api/settings", { method: "PATCH", json: v });
          setV(r);
          setMsg({ tone: "good", text: "Settings saved." });
          router.refresh();
        } catch (err) {
          setMsg({ tone: "bad", text: err instanceof ApiFailure ? err.message : "Couldn't save." });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label htmlFor="tz" className={labelClass}>
          Timezone (used for dates and reminder times)
        </label>
        <select id="tz" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} className={`${inputClass} mt-1 max-w-xs`}>
          {[...new Set([v.timezone, ...ZONES])].map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">Existing return dates keep the timezone they were confirmed in.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-medium">Email</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.emailAlerts} onChange={(e) => setV({ ...v, emailAlerts: e.target.checked })} /> Price alert emails
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.emailReminders} onChange={(e) => setV({ ...v, emailReminders: e.target.checked })} /> Return reminder emails
        </label>
        <p className="text-xs text-muted">In-app alerts are always kept. Sign-in emails are sent regardless of these settings. BuyTrail sends no marketing email.</p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-medium">No price-alert email for these categories</legend>
        {categories.map((c) => (
          <label key={c.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v.categoryEmailOptOut.includes(c.key)}
              onChange={(e) => setV({ ...v, categoryEmailOptOut: e.target.checked ? [...v.categoryEmailOptOut, c.key] : v.categoryEmailOptOut.filter((x) => x !== c.key) })}
            />{" "}
            {c.label}
          </label>
        ))}
      </fieldset>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <button className={buttonPrimary} disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
