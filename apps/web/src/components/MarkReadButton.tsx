"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./client-api";
import { buttonSecondary } from "./ui";

export function MarkReadButton({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={buttonSecondary}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api("/api/notifications", { method: "POST", json: { ids } }).catch(() => null);
        router.refresh();
        setBusy(false);
      }}
    >
      Mark all as read
    </button>
  );
}
