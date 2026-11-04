"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./client-api";
import { buttonSecondary } from "./ui";

export function ItemStatusButton({ itemId, status }: { itemId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = status === "returned" ? "kept" : "returned";
  return (
    <button
      type="button"
      className={buttonSecondary}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api(`/api/purchase-items/${itemId}/status`, { method: "PUT", json: { status: next } }).catch(() => null);
        router.refresh();
        setBusy(false);
      }}
    >
      {status === "returned" ? "Mark as kept" : "Mark as returned"}
    </button>
  );
}
