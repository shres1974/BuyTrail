"use client";
import { useState } from "react";
import { buttonPrimary, inputClass, labelClass, Notice } from "./ui";

export function SignInForm({ next, localMailbox }: { next: string; localMailbox: string | null }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          setState("error");
          setMessage("Enter a valid email address.");
          return;
        }
        setState("busy");
        try {
          const r = await fetch("/api/auth/sign-in/magic-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: email.trim(), callbackURL: next }),
          });
          if (r.status === 429) throw new Error("Too many sign-in attempts. Wait a minute and try again.");
          if (!r.ok) throw new Error("Couldn't send the sign-in link right now. Try again in a few minutes.");
          setState("sent");
        } catch (err) {
          setState("error");
          setMessage((err as Error).message);
        }
      }}
    >
      <div>
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={state === "error"} className={`${inputClass} mt-1`} />
      </div>
      {state === "sent" && (
        <Notice tone="good" title="Check your email">
          We sent a sign-in link to {email}. It expires in 10 minutes.
          {localMailbox && (
            <>
              {" "}
              Local development: open the local mailbox at{" "}
              <a className="underline" href={localMailbox} target="_blank" rel="noreferrer">
                {localMailbox}
              </a>
              .
            </>
          )}
        </Notice>
      )}
      {state === "error" && <Notice tone="bad">{message}</Notice>}
      <button type="submit" className={buttonPrimary} disabled={state === "busy"}>
        {state === "busy" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
