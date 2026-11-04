import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_API_URL ?? "http://localhost:8025";

/** Fetch the newest message to `to` from Mailpit and return its text body. */
export async function latestEmail(to: string, opts: { subjectIncludes?: string; after?: number; timeoutMs?: number } = {}): Promise<{ subject: string; text: string }> {
  const end = Date.now() + (opts.timeoutMs ?? 20_000);
  while (Date.now() < end) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`);
    const j = (await r.json()) as { messages: Array<{ ID: string; Subject: string; Created: string }> };
    const m = j.messages.find((x) => (!opts.subjectIncludes || x.Subject.includes(opts.subjectIncludes)) && (!opts.after || new Date(x.Created).getTime() >= opts.after));
    if (m) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string; Subject: string };
      return { subject: full.Subject, text: full.Text };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`No email to ${to}${opts.subjectIncludes ? ` with subject containing "${opts.subjectIncludes}"` : ""}`);
}

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
}

/** Sign in through the real magic-link flow: request link, read it from Mailpit, open it. */
export async function signIn(page: Page, email: string, next = "/watchlist") {
  const started = Date.now() - 1000;
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  const mail = await latestEmail(email, { subjectIncludes: "sign-in link", after: started });
  const url = /https?:\/\/\S+/.exec(mail.text)?.[0];
  expect(url, "sign-in link present").toBeTruthy();
  await page.goto(url!);
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in") && !u.pathname.startsWith("/api/auth"));
}

/** Wait for the worker to process background work, refreshing the page between checks. */
export async function eventually(page: Page, check: () => Promise<boolean>, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await page.waitForTimeout(1000);
    await page.reload();
  }
  throw new Error("condition not met in time");
}
