"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiFailure, newIdempotencyKey } from "./client-api";
import { buttonPrimary, buttonSecondary, inputClass, labelClass, Notice } from "./ui";

type Item = { description: string; quantity: number; variantId?: string | null };

export function PurchaseForm({ today, prefill, hasActiveWatches }: { today: string; prefill: { variantId: string; description: string } | null; hasActiveWatches: boolean }) {
  const router = useRouter();
  const [merchantName, setMerchant] = useState("");
  const [purchasedOn, setDate] = useState(today);
  const [paidTotal, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([{ description: prefill?.description ?? "", quantity: 1, variantId: prefill?.variantId ?? null }]);
  const [pauseWatches, setPause] = useState(hasActiveWatches);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields?: Record<string, string> } | null>(null);
  const idem = useMemo(() => newIdempotencyKey("purchase"), []);
  const f = error?.fields ?? {};

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const p = await api<{ id: string }>("/api/purchases", {
            method: "POST",
            idempotencyKey: idem,
            json: { merchantName, purchasedOn, paidTotal: paidTotal || null, notes: notes || null, items, pauseWatches },
          });
          router.push(`/purchases/${p.id}`);
        } catch (err) {
          // Keep every entered value; show field errors.
          setError(err instanceof ApiFailure ? { message: err.message, fields: err.error.fields } : { message: "Couldn't save the purchase." });
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="merchant" className={labelClass}>
            Merchant
          </label>
          <input id="merchant" value={merchantName} onChange={(e) => setMerchant(e.target.value)} required aria-invalid={!!f.merchantName} className={`${inputClass} mt-1`} />
          {f.merchantName && <p className="mt-1 text-xs text-bad">{f.merchantName}</p>}
        </div>
        <div>
          <label htmlFor="date" className={labelClass}>
            Purchase date
          </label>
          <input id="date" type="date" value={purchasedOn} onChange={(e) => setDate(e.target.value)} required aria-invalid={!!f.purchasedOn} className={`${inputClass} mt-1`} />
          {f.purchasedOn && <p className="mt-1 text-xs text-bad">{f.purchasedOn}</p>}
        </div>
        <div>
          <label htmlFor="paid" className={labelClass}>
            Amount paid (CAD, including tax if you know it)
          </label>
          <input id="paid" inputMode="decimal" value={paidTotal} onChange={(e) => setPaid(e.target.value)} placeholder="231.65" aria-invalid={!!f.paidTotal} className={`${inputClass} mt-1`} />
          {f.paidTotal && <p className="mt-1 text-xs text-bad">{f.paidTotal}</p>}
        </div>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Items</legend>
        {items.map((it, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <label htmlFor={`d-${i}`} className="text-xs text-muted">
                Description
              </label>
              <input
                id={`d-${i}`}
                value={it.description}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                aria-invalid={!!f[`items.${i}.description`]}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div className="w-24">
              <label htmlFor={`q-${i}`} className="text-xs text-muted">
                Quantity
              </label>
              <input
                id={`q-${i}`}
                type="number"
                min={1}
                value={it.quantity}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))}
                className={`${inputClass} mt-1`}
              />
            </div>
            {items.length > 1 && (
              <button type="button" className={buttonSecondary} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                Remove<span className="sr-only"> item {i + 1}</span>
              </button>
            )}
            {it.variantId && <p className="w-full text-xs text-muted">Linked to catalog variant {it.variantId}</p>}
          </div>
        ))}
        <button type="button" className={buttonSecondary} onClick={() => setItems([...items, { description: "", quantity: 1 }])}>
          Add another item
        </button>
      </fieldset>
      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes (private)
        </label>
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} className={`${inputClass} mt-1`} />
      </div>
      {hasActiveWatches && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pauseWatches} onChange={(e) => setPause(e.target.checked)} />
          Pause my price watches for this item
        </label>
      )}
      <p className="text-xs text-muted">You can add return dates and a receipt after saving. BuyTrail never assumes a default return window.</p>
      {error && <Notice tone="bad">{error.message}</Notice>}
      <button type="submit" disabled={busy} className={buttonPrimary}>
        {busy ? "Saving…" : "Save purchase"}
      </button>
    </form>
  );
}
