"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "./client-api";
import { buttonSecondary, inputClass, labelClass, Notice } from "./ui";

type E = { id: string; state: string; createdAt: string; expiresAt: string | null };

export function AccountDataPanel({ email, exports }: { email: string; exports: E[] }) {
  const router = useRouter();
  const [confirmEmail, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = exports.some((x) => x.state === "pending");
  return (
    <div className="mt-3 space-y-6 text-sm">
      <div>
        <h3 className="font-medium">Export</h3>
        <p className="text-muted">A private ZIP of your watches, purchases, return dates, alerts, settings and receipt files. Download links expire after 24 hours.</p>
        <button
          type="button"
          className={`${buttonSecondary} mt-2`}
          disabled={busy || pending}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/api/account/export", { method: "POST" });
              setMsg({ tone: "good", text: "Export requested. Refresh in a few seconds." });
              router.refresh();
            } catch (e) {
              setMsg({ tone: "bad", text: e instanceof ApiFailure ? e.message : "Couldn't request an export." });
            } finally {
              setBusy(false);
            }
          }}
        >
          {pending ? "Export in progress…" : "Request export"}
        </button>
        {exports.length > 0 && (
          <ul className="mt-2 space-y-1">
            {exports.map((x) => (
              <li key={x.id}>
                {new Date(x.createdAt).toLocaleString("en-CA")} — {x.state}
                {x.state === "ready" && (
                  <>
                    {" "}
                    <a className="text-teal underline" href={`/api/account/export/${x.id}`}>
                      Download
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="space-y-2 rounded-lg border border-bad/30 bg-bad-soft p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!confirm("Delete your BuyTrail account and all private data? This cannot be undone.")) return;
          setBusy(true);
          try {
            await api("/api/account", { method: "DELETE", json: { confirmEmail } });
            // Full reload so the revoked session cookie is not reused by cached client state.
            window.location.assign(new URL("/", window.location.origin).toString());
          } catch (err) {
            setMsg({ tone: "bad", text: err instanceof ApiFailure ? err.message : "Couldn't delete the account." });
            setBusy(false);
          }
        }}
      >
        <h3 className="font-medium text-bad">Delete account</h3>
        <p className="text-bad">
          Signs you out everywhere, cancels pending alerts and reminders, and deletes your watches, purchases, receipts and settings. Backups are retained per the
          documented backup policy and reconciled against deletion records on restore.
        </p>
        <label htmlFor="confirm-email" className={labelClass}>
          Type <strong>{email}</strong> to confirm
        </label>
        <input id="confirm-email" value={confirmEmail} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className={`${inputClass} max-w-sm`} />
        <button className="rounded-md bg-bad px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={busy || confirmEmail.trim().toLowerCase() !== email.toLowerCase()}>
          Delete my account
        </button>
      </form>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
