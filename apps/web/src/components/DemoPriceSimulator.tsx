"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "./client-api";
import { buttonSecondary, inputClass } from "./ui";

/**
 * Demonstration-only control: script a new price for one sample listing and run it through the
 * real ingestion → watch evaluation → notification pipeline. Clearly labelled as simulated.
 */
export function DemoPriceSimulator({ offers }: { offers: Array<{ id: string; label: string; url: string }> }) {
  const router = useRouter();
  const [listing, setListing] = useState(() => offers[0]?.url.split("/p/")[1] ?? "");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (offers.length === 0) return null;
  return (
    <details className="mt-6 rounded-lg border border-sample/30 bg-sample-soft p-3 text-sm">
      <summary className="cursor-pointer font-medium text-sample">Simulate a sample price change (demonstration mode)</summary>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await api("/api/demo/simulate-price", { method: "POST", json: { externalListingId: decodeURIComponent(listing), itemPrice: price.trim() === "" ? null : price.trim() } });
            setMsg("Sample price change applied through the normal pipeline. Watches are evaluated by the worker within a few seconds.");
            router.refresh();
          } catch (err) {
            setMsg(err instanceof ApiFailure ? err.message : "Simulation failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block">
          <span className="text-xs text-muted">Sample listing</span>
          <select value={listing} onChange={(e) => setListing(e.target.value)} className={`${inputClass} mt-1`}>
            {offers.map((o) => (
              <option key={o.id} value={o.url.split("/p/")[1]}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">New item price (CAD; blank = reset)</span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="99.00" className={`${inputClass} mt-1 w-32`} />
        </label>
        <button className={buttonSecondary} disabled={busy}>
          {busy ? "Applying…" : "Apply sample price"}
        </button>
      </form>
      {msg && (
        <p role="status" className="mt-2 text-xs text-sample">
          {msg}
        </p>
      )}
    </details>
  );
}
