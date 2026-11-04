"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "./client-api";
import { Badge, buttonPrimary, buttonSecondary, Notice } from "./ui";

type R = { id: string; state: string; declaredType: string; size: number; rejectReason: string | null; isSynthetic: boolean; createdAt: string };

const STATE: Record<string, { label: string; tone: "neutral" | "good" | "warn" | "bad" }> = {
  pending: { label: "Waiting for upload", tone: "neutral" },
  processing: { label: "Checking file…", tone: "neutral" },
  ready: { label: "Ready", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
  deleting: { label: "Deleting", tone: "warn" },
};

export function ReceiptPanel({ purchaseId, receipts, uploadsAllowed, maxBytes }: { purchaseId: string; receipts: R[]; uploadsAllowed: boolean; maxBytes: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "good"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const processing = receipts.some((r) => r.state === "processing" || r.state === "pending");

  // Poll while validation runs in the worker.
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(t);
  }, [processing, router]);

  const attachSample = async (sampleId: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/purchases/${purchaseId}/sample-receipt`, { method: "POST", json: { sampleId } });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof ApiFailure ? e.message : "Couldn't attach the sample." });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      if (file.size > maxBytes) throw new Error(`Files can be at most ${Math.floor(maxBytes / 1048576)} MiB.`);
      const type = file.type === "application/pdf" || file.type === "image/png" || file.type === "image/jpeg" ? file.type : null;
      if (!type) throw new Error("Only PDF, JPEG and PNG receipts are supported.");
      const intent = await api<{ receiptId: string; uploadUrl: string }>("/api/receipts/upload-intents", { method: "POST", json: { purchaseId, contentType: type, size: file.size } });
      const put = await fetch(intent.uploadUrl, { method: "PUT", headers: { "content-type": type }, body: file });
      if (!put.ok) throw new Error((await put.json().catch(() => null))?.error?.message ?? "Upload failed.");
      await api(`/api/receipts/${intent.receiptId}/confirm`, { method: "POST" });
      router.refresh();
    } catch (e) {
      // A failed upload never affects the saved purchase.
      setMsg({ tone: "bad", text: e instanceof ApiFailure ? e.message : (e as Error).message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      {receipts.length === 0 && <p className="text-sm text-muted">No receipt attached.</p>}
      <ul className="space-y-2">
        {receipts.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card p-3 text-sm" data-testid="receipt">
            {r.state === "ready" && r.declaredType !== "application/pdf" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/receipts/${r.id}/download?variant=preview`} alt="Receipt preview" className="h-16 w-12 rounded border border-line object-cover" />
            ) : (
              <span aria-hidden="true" className="flex h-16 w-12 items-center justify-center rounded border border-line bg-paper text-xs text-muted">
                {r.declaredType === "application/pdf" ? "PDF" : "IMG"}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2">
                <Badge tone={STATE[r.state]?.tone ?? "neutral"}>{STATE[r.state]?.label ?? r.state}</Badge>
                {r.isSynthetic && <Badge tone="sample">Synthetic sample</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted">
                {r.declaredType.replace("application/", "").replace("image/", "").toUpperCase()} · {(r.size / 1024).toFixed(0)} KiB
                {r.rejectReason && <> · Reason: {r.rejectReason.replace(/_/g, " ")}</>}
              </p>
            </div>
            {r.state === "ready" && (
              <a href={`/api/receipts/${r.id}/download`} className="text-sm font-medium text-teal underline">
                Download
              </a>
            )}
            <button
              type="button"
              className={buttonSecondary}
              disabled={busy}
              onClick={async () => {
                if (!confirm("Delete this receipt? The purchase and any return date stay.")) return;
                setBusy(true);
                await api(`/api/receipts/${r.id}`, { method: "DELETE" }).catch(() => null);
                router.refresh();
                setBusy(false);
              }}
            >
              Delete<span className="sr-only"> receipt</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonSecondary} disabled={busy} onClick={() => attachSample("sample-receipt-png")}>
          Attach a sample receipt (image)
        </button>
        <button type="button" className={buttonSecondary} disabled={busy} onClick={() => attachSample("sample-receipt-pdf")}>
          Attach a sample receipt (PDF)
        </button>
        {uploadsAllowed ? (
          <>
            <label htmlFor="receipt-file" className={buttonPrimary}>
              Upload a receipt
            </label>
            <input
              id="receipt-file"
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </>
        ) : (
          <p className="text-xs text-muted" data-testid="uploads-disabled">
            File uploads are disabled in this demonstration — please don&apos;t upload real receipts. Use a sample receipt instead.
          </p>
        )}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
