"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "./client-api";
import { buttonPrimary, buttonSecondary, inputClass, Notice } from "./ui";

export function MatchDecisionForm({ decisionId, candidates }: { decisionId: string; candidates: Array<{ id: string; title: string }> }) {
  const router = useRouter();
  const [variantId, setVariant] = useState(candidates[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (action: "verify" | "reject") => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/admin/matches/${decisionId}/decision`, { method: "POST", json: { action, variantId: action === "verify" ? variantId : undefined, note: note || undefined } });
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
      {candidates.length > 0 && (
        <label className="block">
          <span className="text-xs text-muted">Link to variant</span>
          <select value={variantId} onChange={(e) => setVariant(e.target.value)} className={`${inputClass} mt-1 max-w-md`}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="text-xs text-muted">Note (audit)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} mt-1`} />
      </label>
      {candidates.length > 0 && (
        <button type="button" className={buttonPrimary} disabled={busy} onClick={() => decide("verify")}>
          Verify match
        </button>
      )}
      <button type="button" className={buttonSecondary} disabled={busy} onClick={() => decide("reject")}>
        Reject
      </button>
      {err && <Notice tone="bad">{err}</Notice>}
    </div>
  );
}
