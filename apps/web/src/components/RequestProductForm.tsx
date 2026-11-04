"use client";
import { useState } from "react";
import { api, ApiFailure } from "./client-api";
import { buttonSecondary } from "./ui";

export function RequestProductForm({ query }: { query: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  return (
    <div className="text-sm">
      <button
        type="button"
        className={buttonSecondary}
        disabled={state === "busy" || state === "done"}
        onClick={async () => {
          setState("busy");
          try {
            const r = await api<{ message: string }>("/api/product-requests", { method: "POST", json: { query } });
            setMsg(r.message);
            setState("done");
          } catch (e) {
            setMsg(e instanceof ApiFailure ? e.message : "Couldn't record the request.");
            setState("error");
          }
        }}
      >
        {state === "done" ? "Request recorded" : `Request “${query}”`}
      </button>
      {msg && (
        <p role="status" className="mt-2 text-muted">
          {msg}
        </p>
      )}
    </div>
  );
}
